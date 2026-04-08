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


class TokenHandler(APIHandler):
    @web.authenticated
    async def get(self):
        token = os.environ.get("SHARING_API_TOKEN")
        if not token:
            self.set_status(404)
            self.finish(json.dumps({"error": "API token is not available. Please restart your server."}))
            return
        self.finish(json.dumps({"token": token}))


class ShareHandler(APIHandler):
    @web.authenticated
    async def post(self):
        try:
            data = self.get_json_body()

            directory_name = data.get("directory_name")
            share_with_user = data.get("share_with_user")
            access_rights = data.get("access_rights", "read")
            token = data.get("token")

            if not directory_name or not share_with_user:
                self.set_status(400)
                self.finish(json.dumps({"error": "Missing directory_name or share_with_user"}))
                return

            if not token:
                self.set_status(400)
                self.finish(json.dumps({"error": "Missing auth token"}))
                return

            owner = os.environ.get("JUPYTERHUB_USER")
            if not owner:
                self.set_status(500)
                self.finish(json.dumps({"error": "JUPYTERHUB_USER not set"}))
                return

            payload = {
                "owner": owner,
                "directory_name": directory_name,
                "share_with_user": share_with_user,
                "access_rights": access_rights,
            }

            http_client = AsyncHTTPClient()
            request = HTTPRequest(
                url=f"{SHARING_API_URL}/share",
                method="POST",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                body=json.dumps(payload),
                request_timeout=10,
            )
            response = await http_client.fetch(request, raise_error=False)

            self.set_status(response.code)
            self.finish(response.body)

        except Exception as e:
            self.log.error(f"Error in ShareHandler: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


class PermissionsHandler(APIHandler):
    @web.authenticated
    async def get(self):
        """Fetch permissions for a folder from the sharing API."""
        try:
            directory = self.get_argument("directory", None)
            if not directory:
                self.set_status(400)
                self.finish(json.dumps({"error": "Missing directory parameter"}))
                return

            token = self.request.headers.get("Authorization", "").replace("Bearer ", "")
            if not token:
                self.set_status(401)
                self.finish(json.dumps({"error": "Missing auth token"}))
                return

            owner = os.environ.get("JUPYTERHUB_USER", "")

            # We need to find the volume_name for this directory+owner combo
            # First get the user's shares to find the matching volume
            http_client = AsyncHTTPClient()
            request = HTTPRequest(
                url=f"{SHARING_API_URL}/share/my-shares",
                method="GET",
                headers={"Authorization": f"Bearer {token}"},
                request_timeout=10,
            )
            response = await http_client.fetch(request, raise_error=False)

            if response.code != 200:
                self.set_status(response.code)
                self.finish(response.body)
                return

            shares_data = json.loads(response.body)
            volume_name = None
            for share in shares_data.get("shares", []):
                if share.get("display_name") == directory and share.get("owner") == owner:
                    volume_name = share.get("volume_name")
                    break

            if not volume_name:
                self.set_status(404)
                self.finish(json.dumps({"error": "This folder has not been shared yet"}))
                return

            # Now fetch permissions for that volume
            request = HTTPRequest(
                url=f"{SHARING_API_URL}/share/permissions/{volume_name}",
                method="GET",
                headers={"Authorization": f"Bearer {token}"},
                request_timeout=10,
            )
            response = await http_client.fetch(request, raise_error=False)

            self.set_status(response.code)
            self.finish(response.body)

        except Exception as e:
            self.log.error(f"Error in PermissionsHandler GET: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))

    @web.authenticated
    async def delete(self):
        """Revoke a user's access to a shared folder."""
        try:
            data = self.get_json_body()
            token = data.get("token")

            if not token:
                self.set_status(401)
                self.finish(json.dumps({"error": "Missing auth token"}))
                return

            payload = {
                "volume_name": data.get("volume_name"),
                "user_email": data.get("user_email"),
            }

            http_client = AsyncHTTPClient()
            request = HTTPRequest(
                url=f"{SHARING_API_URL}/share/permissions",
                method="DELETE",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                body=json.dumps(payload),
                request_timeout=10,
            )
            response = await http_client.fetch(request, raise_error=False)

            self.set_status(response.code)
            self.finish(response.body)

        except Exception as e:
            self.log.error(f"Error in PermissionsHandler DELETE: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    handlers = [
        (url_path_join(base_url, "jlab-examples", "google-token"), TokenHandler),
        (url_path_join(base_url, "jlab-examples", "share"), ShareHandler),
        (url_path_join(base_url, "jlab-examples", "permissions"), PermissionsHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)
