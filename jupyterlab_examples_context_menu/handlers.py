import json
import os

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado import web


class GoogleTokenHandler(APIHandler):
    @web.authenticated
    async def get(self):
        token = os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN")
        
        # Debug logging
        print(f"Checking for GOOGLE_OAUTH_ACCESS_TOKEN. Found: {token is not None}")
        if not token:
            print("Available environment variables:")
            for key in os.environ:
                if "TOKEN" in key or "GOOGLE" in key:
                    print(f"{key}: {os.environ[key][:10]}...")

        if not token:
            self.set_status(404)
            self.finish(json.dumps({"error": "Google token is not available"}))
            return

        self.finish(json.dumps({"token": token}))


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    route_pattern = url_path_join(base_url, "jlab-examples", "google-token")

    handlers = [(route_pattern, GoogleTokenHandler)]
    web_app.add_handlers(host_pattern, handlers)

