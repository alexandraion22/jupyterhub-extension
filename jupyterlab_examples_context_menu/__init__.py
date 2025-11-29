from typing import Any, Dict, List

try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs
    import warnings
    warnings.warn("Importing 'jupyterlab_examples_context_menu' outside a proper installation.")
    __version__ = "dev"

from .handlers import setup_handlers

def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "@jupyterlab-examples/context-menu"
    }]


def _jupyter_server_extension_points() -> List[Dict[str, Any]]:
    return [{
        "module": "jupyterlab_examples_context_menu"
    }]


def _load_jupyter_server_extension(server_app):
    """Register API handlers when the server extension is loaded."""
    setup_handlers(server_app.web_app)
