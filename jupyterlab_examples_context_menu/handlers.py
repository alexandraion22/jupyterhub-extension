import json
import os
import requests
import tornado

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


class ShareHandler(APIHandler):
    @web.authenticated
    async def post(self):
        try:
            data = self.get_json_body()
            
            # Get parameters from request
            directory_name = data.get("directory_name")
            share_with_user = data.get("share_with_user")
            access_rights = data.get("access_rights", "read")
            token = data.get("token")
            
            if not directory_name or not share_with_user:
                self.set_status(400)
                self.finish(json.dumps({"error": "Missing directory_name or share_with_user"}))
                return

            # Get current user (owner) from environment or JupyterHub user
            # JUPYTERHUB_USER is usually set in the singleuser environment
            owner = os.environ.get("JUPYTERHUB_USER")
            if not owner:
                # Fallback if not running in typical JH environment (e.g. dev)
                # We can try to get it from the token or just fail
                owner = "unknown-user"
                print("Warning: JUPYTERHUB_USER not found, using 'unknown-user'")

            # Prepare payload for the API
            payload = {
                "owner": owner,
                "directory_name": directory_name,
                "share_with_user": share_with_user,
                "access_rights": access_rights
            }
            
            # API URL - using host.docker.internal to reach the host where API container runs
            # Note: This assumes the pod can resolve host.docker.internal
            api_url = "http://host.docker.internal:8000/share"
            
            print(f"Forwarding share request to {api_url}: {payload}")
            
            # Make request to the Config API
            # Using requests (synchronous) - in a real app, assume this is fast or use async http client
            response = requests.post(api_url, json=payload, timeout=10)
            
            self.set_status(response.status_code)
            self.finish(response.text)
            
        except Exception as e:
            print(f"Error in ShareHandler: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    
    # Register handlers
    handlers = [
        (url_path_join(base_url, "jlab-examples", "google-token"), GoogleTokenHandler),
        (url_path_join(base_url, "jlab-examples", "share"), ShareHandler)
    ]
    
    web_app.add_handlers(host_pattern, handlers)
