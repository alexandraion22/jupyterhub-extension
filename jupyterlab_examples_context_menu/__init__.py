from typing import Any, Dict, List

from tornado import web

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


def _is_managed_shared_path(path: str) -> bool:
    """True for the top-level 'shared' folder or its direct children (mount points).

    Sub-paths deeper than one level (e.g. `shared/SomeShare/file.ipynb`) are
    NOT blocked — that's the live-shared content, which must be editable by
    collaborators with write access.
    """
    if not path:
        return False
    clean = path.strip("/")
    if clean == "shared":
        return True
    if clean.startswith("shared/"):
        # Direct child of shared/? (no further slash)
        return "/" not in clean[len("shared/"):]
    return False


def _install_shared_guard(server_app) -> None:
    """Prevent users from renaming or deleting `/shared/` and its mountpoints.

    The `/shared/` directory is created implicitly by kubelet when it mounts
    each share as a subPath volume. Renaming or deleting it from the file
    browser would either error out weirdly or silently remove the mount
    record, so we reject those operations at the ContentsManager layer.
    """
    cm = server_app.contents_manager
    orig_rename = cm.rename_file
    orig_delete = cm.delete_file

    def _deny(path: str):
        raise web.HTTPError(
            403,
            f"'{path or 'shared'}' is part of the managed /shared/ folder and cannot be renamed or deleted from the file browser.",
        )

    def rename_file(old_path, new_path):
        if _is_managed_shared_path(old_path) or _is_managed_shared_path(new_path):
            _deny(old_path or new_path)
        return orig_rename(old_path, new_path)

    def delete_file(path):
        if _is_managed_shared_path(path):
            _deny(path)
        return orig_delete(path)

    cm.rename_file = rename_file
    cm.delete_file = delete_file
    server_app.log.info("Installed /shared/ write guard on ContentsManager")


def _load_jupyter_server_extension(server_app):
    """Register API handlers and the /shared/ write guard."""
    setup_handlers(server_app.web_app)
    try:
        _install_shared_guard(server_app)
    except Exception as e:
        server_app.log.warning(f"Could not install shared guard: {e}")
