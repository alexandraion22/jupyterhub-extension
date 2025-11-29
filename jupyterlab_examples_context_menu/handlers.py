import json
import os

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado import web
from tornado.httpclient import AsyncHTTPClient, HTTPRequest, HTTPClientError

HUB_API_URL = os.environ.get("JUPYTERHUB_API_URL")
HUB_API_TOKEN = os.environ.get("JUPYTERHUB_API_TOKEN")
HUB_TOKEN_ENDPOINT = (
    f"{HUB_API_URL.rstrip('/')}/google-token" if HUB_API_URL else None
)
REQUEST_TIMEOUT = 5  # seconds


class GoogleTokenHandler(APIHandler):
    @web.authenticated
    async def get(self):
        token, error_status, error_message = await fetch_google_token()

        if token:
            self.finish(json.dumps({"token": token}))
            return

        self.set_status(error_status)
        self.finish(json.dumps({"error": error_message}))


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    route_pattern = url_path_join(base_url, "jlab-examples", "google-token")

    handlers = [(route_pattern, GoogleTokenHandler)]
    web_app.add_handlers(host_pattern, handlers)


async def fetch_google_token():
    """Proxy the Google token from the Hub-side API endpoint."""
    if not HUB_TOKEN_ENDPOINT or not HUB_API_TOKEN:
        return None, 503, "Hub API environment variables are not configured"

    client = AsyncHTTPClient()
    request = HTTPRequest(
        HUB_TOKEN_ENDPOINT,
        method="GET",
        headers={"Authorization": f"token {HUB_API_TOKEN}"},
        request_timeout=REQUEST_TIMEOUT,
    )

    try:
        response = await client.fetch(request, raise_error=False)
    except HTTPClientError as exc:
        return None, 502, f"Failed to reach Hub token endpoint: {exc}"

    if response.code == 200:
        try:
            data = json.loads(response.body.decode("utf-8"))
        except json.JSONDecodeError:
            return None, 502, "Hub token endpoint returned invalid JSON"
        token = data.get("token")
        if token:
            return token, 200, None

    if response.code == 404:
        return None, 404, "Google token is not available"

    return (
        None,
        response.code or 502,
        f"Hub token endpoint error ({response.code})",
    )


