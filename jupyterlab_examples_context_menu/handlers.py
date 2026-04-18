import json
import os

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado import web
from tornado.httpclient import AsyncHTTPClient, HTTPRequest


SHARING_API_URL = os.environ.get(
    "SHARING_API_URL",
    "http://sharing-api.jhub.svc.cluster.local:8000"
)


def _bearer_token(handler: APIHandler) -> str | None:
    auth = handler.request.headers.get("Authorization", "")
    if not auth:
        return None
    # JupyterLab's ServerConnection also injects `token <oauth>` into the
    # Authorization header; duplicate headers get joined by the browser as
    # `Bearer <jwt>, token <oauth>`. Pick the first Bearer segment.
    for seg in auth.split(","):
        seg = seg.strip()
        if seg.startswith("Bearer "):
            return seg.split(" ", 1)[1].strip()
    return None


async def _proxy(handler: APIHandler, method: str, path: str, token: str, body: dict | None = None):
    http_client = AsyncHTTPClient()
    req = HTTPRequest(
        url=f"{SHARING_API_URL}{path}",
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        body=json.dumps(body) if body is not None else None,
        allow_nonstandard_methods=True,
        request_timeout=10,
    )
    response = await http_client.fetch(req, raise_error=False)
    handler.set_status(response.code)
    handler.finish(response.body)


class TokenHandler(APIHandler):
    @web.authenticated
    async def get(self):
        token = os.environ.get("SHARING_API_TOKEN")
        if not token:
            self.set_status(404)
            self.finish(json.dumps({"error": "API token is not available. Please restart your server."}))
            return
        self.finish(json.dumps({"token": token}))


class MeHandler(APIHandler):
    @web.authenticated
    async def get(self):
        email = os.environ.get("JUPYTERHUB_USER", "")
        domain = email.rsplit("@", 1)[-1] if "@" in email else ""
        self.finish(json.dumps({"email": email, "domain": domain}))


class ShareHandler(APIHandler):
    @web.authenticated
    async def post(self):
        try:
            data = self.get_json_body() or {}
            token = data.pop("token", None) or _bearer_token(self)
            if not token:
                self.set_status(401)
                self.finish(json.dumps({"error": "Missing auth token"}))
                return

            owner = os.environ.get("JUPYTERHUB_USER")
            if not owner:
                self.set_status(500)
                self.finish(json.dumps({"error": "JUPYTERHUB_USER not set"}))
                return

            directory_name = data.get("directory_name")
            if not directory_name:
                self.set_status(400)
                self.finish(json.dumps({"error": "Missing directory_name"}))
                return

            payload = {"owner": owner, "directory_name": directory_name}
            for key in ("recipients", "share_with_user", "access_rights",
                        "general_access", "link_access_level"):
                if key in data:
                    payload[key] = data[key]

            await _proxy(self, "POST", "/share", token, payload)

        except Exception as e:
            self.log.error(f"Error in ShareHandler: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


class PermissionsHandler(APIHandler):
    @web.authenticated
    async def get(self):
        """Look up permissions by directory name or volume_name."""
        try:
            token = _bearer_token(self)
            if not token:
                self.set_status(401)
                self.finish(json.dumps({"error": "Missing auth token"}))
                return

            volume_name = self.get_argument("volume_name", None)
            directory = self.get_argument("directory", None)

            if not volume_name:
                if not directory:
                    self.set_status(400)
                    self.finish(json.dumps({"error": "Provide volume_name or directory"}))
                    return
                me = os.environ.get("JUPYTERHUB_USER", "")
                http_client = AsyncHTTPClient()
                req = HTTPRequest(
                    url=f"{SHARING_API_URL}/share/my-shares",
                    method="GET",
                    headers={"Authorization": f"Bearer {token}"},
                    request_timeout=10,
                )
                response = await http_client.fetch(req, raise_error=False)
                if response.code != 200:
                    self.set_status(response.code)
                    self.finish(response.body)
                    return
                shares_data = json.loads(response.body)
                # Resolve `directory` (as seen in the file browser) back to a
                # volume_name. We accept three shapes:
                #   1. legacy mount path "share-<uuid>" matching volume_name
                #   2. the owner's own folder name (prefer this if we own it)
                #   3. a recipient-side "shared/<display_name>" folder name
                match = None
                for share in shares_data.get("shares", []):
                    if share.get("volume_name") == directory:
                        match = share
                        break
                    if share.get("display_name") == directory:
                        if share.get("owner") == me:
                            match = share
                            break
                        if match is None:
                            match = share
                if not match:
                    self.set_status(404)
                    self.finish(json.dumps({"error": "This folder has not been shared yet"}))
                    return
                volume_name = match.get("volume_name")

            await _proxy(self, "GET", f"/share/permissions/{volume_name}", token)

        except Exception as e:
            self.log.error(f"Error in PermissionsHandler GET: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))

    @web.authenticated
    async def delete(self):
        try:
            data = self.get_json_body() or {}
            token = data.pop("token", None) or _bearer_token(self)
            if not token:
                self.set_status(401)
                self.finish(json.dumps({"error": "Missing auth token"}))
                return
            await _proxy(self, "DELETE", "/share/permissions", token, {
                "volume_name": data.get("volume_name"),
                "user_email": data.get("user_email"),
            })
        except Exception as e:
            self.log.error(f"Error in PermissionsHandler DELETE: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


class GeneralAccessHandler(APIHandler):
    @web.authenticated
    async def put(self, volume_name: str):
        try:
            data = self.get_json_body() or {}
            token = data.pop("token", None) or _bearer_token(self)
            if not token:
                self.set_status(401)
                self.finish(json.dumps({"error": "Missing auth token"}))
                return
            await _proxy(self, "PUT", f"/share/{volume_name}/general-access", token, {
                "general_access": data.get("general_access"),
                "link_access_level": data.get("link_access_level"),
            })
        except Exception as e:
            self.log.error(f"Error in GeneralAccessHandler: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


class AcceptShareHandler(APIHandler):
    @web.authenticated
    async def post(self, volume_name: str):
        try:
            token = _bearer_token(self)
            if not token:
                self.set_status(401)
                self.finish(json.dumps({"error": "Missing auth token"}))
                return
            await _proxy(self, "POST", f"/share/accept/{volume_name}", token)
        except Exception as e:
            self.log.error(f"Error in AcceptShareHandler: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


class MySharesHandler(APIHandler):
    @web.authenticated
    async def get(self):
        try:
            token = _bearer_token(self)
            if not token:
                self.set_status(401)
                self.finish(json.dumps({"error": "Missing auth token"}))
                return
            await _proxy(self, "GET", "/share/my-shares", token)
        except Exception as e:
            self.log.error(f"Error in MySharesHandler: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    handlers = [
        (url_path_join(base_url, "jlab-examples", "google-token"), TokenHandler),
        (url_path_join(base_url, "jlab-examples", "me"), MeHandler),
        (url_path_join(base_url, "jlab-examples", "share"), ShareHandler),
        (url_path_join(base_url, "jlab-examples", "permissions"), PermissionsHandler),
        (url_path_join(base_url, "jlab-examples", "my-shares"), MySharesHandler),
        (url_path_join(base_url, "jlab-examples", "general-access", "(.+)"), GeneralAccessHandler),
        (url_path_join(base_url, "jlab-examples", "accept", "(.+)"), AcceptShareHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
