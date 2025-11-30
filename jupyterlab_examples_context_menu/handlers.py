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

            if not token:
                self.set_status(400)
                self.finish(json.dumps({"error": "Missing auth token"}))
                return

            # Get current user (owner) from environment or JupyterHub user
            owner = os.environ.get("JUPYTERHUB_USER")
            if not owner:
                owner = "unknown-user"
                print("Warning: JUPYTERHUB_USER not found, using 'unknown-user'")

            # Prepare payload for the API (exclude token from body)
            payload = {
                "owner": owner,
                "directory_name": directory_name,
                "share_with_user": share_with_user,
                "access_rights": access_rights
            }
            
            # Prepare headers with Bearer token
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            # API URL - using host.docker.internal to reach the host where API container runs
            api_url = "http://host.docker.internal:8000/share"
            
            print(f"Forwarding share request to {api_url} for {owner}")
            
            # Make request to the Config API
            response = requests.post(api_url, json=payload, headers=headers, timeout=10)
            
            self.set_status(response.status_code)
            self.finish(response.text)
            
        except requests.exceptions.RequestException as e:
            print(f"Failed to connect to Config API: {e}")
            self.set_status(502) # Bad Gateway
            self.finish(json.dumps({"error": f"Failed to reach configuration service: {str(e)}"}))
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
