import json
import os
import tornado.httpclient

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
        # Get token from env (preferred as it's secure in backend)
        token = os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN")
        
        if not token:
            self.set_status(401)
            self.finish(json.dumps({"error": "No authentication token available"}))
            return

        try:
            data = json.loads(self.request.body)
        except json.JSONDecodeError:
            self.set_status(400)
            self.finish(json.dumps({"error": "Invalid JSON body"}))
            return

        # Config server URL
        # dynamic_hook.py uses http://host.docker.internal:8000
        config_server_url = os.environ.get("CONFIG_SERVER_URL", "http://host.docker.internal:8000")
        # Remove trailing slash if present
        if config_server_url.endswith('/'):
            config_server_url = config_server_url[:-1]
            
        share_url = f"{config_server_url}/share"

        client = tornado.httpclient.AsyncHTTPClient()
        try:
            # Forward request to config server
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}"
            }
            
            # Note: If you need to simulate a user email for testing the API without a real Google Token validator,
            # you might need to inject X-User-Email here if you can determine it.
            # For now, we rely on the API server to handle the token or fallback.
            
            request = tornado.httpclient.HTTPRequest(
                url=share_url,
                method="POST",
                headers=headers,
                body=json.dumps(data)
            )
            
            response = await client.fetch(request)
            
            # Proxy the response back
            self.set_status(response.code)
            self.finish(response.body)
            
        except tornado.httpclient.HTTPClientError as e:
            print(f"Error proxying to config server: {e}")
            self.set_status(e.code)
            self.finish(e.response.body if e.response else json.dumps({"error": str(e)}))
        except Exception as e:
            print(f"Unexpected error in ShareHandler: {e}")
            self.set_status(500)
            self.finish(json.dumps({"error": f"Internal server error: {str(e)}"}))


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    
    google_token_pattern = url_path_join(base_url, "jlab-examples", "google-token")
    share_pattern = url_path_join(base_url, "jlab-examples", "share")

    handlers = [
        (google_token_pattern, GoogleTokenHandler),
        (share_pattern, ShareHandler)
    ]
    web_app.add_handlers(host_pattern, handlers)
