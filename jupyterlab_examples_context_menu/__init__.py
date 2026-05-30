import contextvars
import inspect
import json
import logging
import os
import time
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Set

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

logger = logging.getLogger(__name__)

SHARING_API_URL = os.environ.get(
    "SHARING_API_URL",
    "http://sharing-api.jhub.svc.cluster.local:8000",
)

# Short TTL so revocation is visible within a few seconds without
# hammering the sharing API on every file-browser click.
_ACCESS_CACHE_TTL = 5.0
_access_cache: Dict[str, Any] = {"names": None, "ts": 0.0}

# Reentrancy guard: True while we're inside a /shared/ listing call, so the
# child `self.get(...)` calls orig_get makes for each directory entry don't
# re-run our revocation check.
_listing_shared: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "listing_shared", default=False
)


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "@jupyterlab-examples/context-menu"
    }]


def _jupyter_server_extension_points() -> List[Dict[str, Any]]:
    return [{
        "module": "jupyterlab_examples_context_menu"
    }]


def _current_user_email() -> str:
    return os.environ.get("JUPYTERHUB_USER", "")


def _fetch_current_share_names() -> Set[str]:
    """The set of sanitized folder names the caller currently has access to,
    i.e. what should actually appear under /home/jovyan/shared/."""
    email = _current_user_email()
    if not email:
        return set()
    url = f"{SHARING_API_URL}/config/{urllib.parse.quote(email)}"
    with urllib.request.urlopen(url, timeout=3) as r:
        data = json.loads(r.read().decode())
    names: Set[str] = set()
    for v in data.get("volumes", []):
        mount_path = v.get("mount_path", "")
        # mount_path looks like /home/jovyan/shared/<sanitized-name>
        if "/shared/" in mount_path:
            names.add(mount_path.rsplit("/", 1)[-1])
    return names


def _current_share_names() -> Set[str]:
    now = time.time()
    cached = _access_cache.get("names")
    if cached is not None and now - _access_cache["ts"] < _ACCESS_CACHE_TTL:
        return cached
    try:
        names = _fetch_current_share_names()
        _access_cache["names"] = names
        _access_cache["ts"] = now
        return names
    except Exception as e:
        logger.warning(f"Could not refresh share access list: {e}")
        # On failure, prefer the last known-good list over an empty set so
        # a transient API hiccup doesn't hide the user's legitimate shares.
        return cached if cached is not None else set()


def _shared_head(clean_path: str) -> Optional[str]:
    """Return the first path segment after 'shared/', or None if not under it."""
    if not clean_path.startswith("shared/"):
        return None
    after = clean_path[len("shared/"):]
    return after.split("/", 1)[0] if after else ""


def _is_managed_shared_path(path: str) -> bool:
    """True for the top-level 'shared' folder or its direct children (mount points)."""
    if not path:
        return False
    clean = path.strip("/")
    if clean == "shared":
        return True
    head = _shared_head(clean)
    if head is None:
        return False
    # Direct child of shared/? (nothing deeper)
    return "/" not in clean[len("shared/"):]


def _reject_if_revoked(path: str) -> None:
    """404 if the path is inside /shared/<X>/ and X isn't a current share."""
    clean = (path or "").strip("/")
    head = _shared_head(clean)
    if head is None or head == "":
        return
    if head not in _current_share_names():
        raise web.HTTPError(404, f"'{path}' not found")


def _install_contents_guards(server_app) -> None:
    """Harden the ContentsManager so `/shared/` behaves like a read-only,
    auto-pruning view onto the user's currently-authorized mounts:

    * `/shared/` itself and its direct children cannot be renamed or deleted
      (those are kubelet-managed mount points).
    * Listings under `/shared/` are filtered to only include folders the
      user currently has access to per the sharing-api, so a share revoked
      while the pod is still running disappears from the file browser
      within ~5 s instead of lingering as an empty directory until the
      next pod restart.

    Supports both sync FileContentsManager and async variants like
    AsyncLargeFileManager — the latter is the JupyterHub default.
    """
    cm = server_app.contents_manager
    orig_get = cm.get
    orig_rename = cm.rename_file
    orig_delete = cm.delete_file
    is_async_get = inspect.iscoroutinefunction(orig_get)
    is_async_rename = inspect.iscoroutinefunction(orig_rename)
    is_async_delete = inspect.iscoroutinefunction(orig_delete)

    def _deny(path: str):
        raise web.HTTPError(
            403,
            f"'{path or 'shared'}' is part of the managed /shared/ folder and cannot be renamed or deleted from the file browser.",
        )

    def _filter_shared_listing(result: Any) -> Any:
        if isinstance(result, dict):
            children = result.get("content")
            if isinstance(children, list):
                allowed = _current_share_names()
                result["content"] = [c for c in children if c.get("name") in allowed]
        return result

    if is_async_get:
        async def get(path, content=True, type=None, format=None, **kwargs):
            clean = (path or "").strip("/")
            if not _listing_shared.get():
                _reject_if_revoked(path)
            if clean == "shared":
                token = _listing_shared.set(True)
                try:
                    # Await inside the try so the contextvar stays set for
                    # the duration of _dir_model's recursive child lookups.
                    result = await orig_get(path, content=content, type=type, format=format, **kwargs)
                finally:
                    _listing_shared.reset(token)
                return _filter_shared_listing(result)
            return await orig_get(path, content=content, type=type, format=format, **kwargs)
    else:
        def get(path, content=True, type=None, format=None, **kwargs):
            clean = (path or "").strip("/")
            if not _listing_shared.get():
                _reject_if_revoked(path)
            if clean == "shared":
                token = _listing_shared.set(True)
                try:
                    result = orig_get(path, content=content, type=type, format=format, **kwargs)
                finally:
                    _listing_shared.reset(token)
                return _filter_shared_listing(result)
            return orig_get(path, content=content, type=type, format=format, **kwargs)

    if is_async_rename:
        async def rename_file(old_path, new_path):
            if _is_managed_shared_path(old_path) or _is_managed_shared_path(new_path):
                _deny(old_path or new_path)
            _reject_if_revoked(old_path)
            return await orig_rename(old_path, new_path)
    else:
        def rename_file(old_path, new_path):
            if _is_managed_shared_path(old_path) or _is_managed_shared_path(new_path):
                _deny(old_path or new_path)
            _reject_if_revoked(old_path)
            return orig_rename(old_path, new_path)

    if is_async_delete:
        async def delete_file(path):
            if _is_managed_shared_path(path):
                _deny(path)
            _reject_if_revoked(path)
            return await orig_delete(path)
    else:
        def delete_file(path):
            if _is_managed_shared_path(path):
                _deny(path)
            _reject_if_revoked(path)
            return orig_delete(path)

    cm.rename_file = rename_file
    cm.delete_file = delete_file
    cm.get = get
    server_app.log.info(
        f"Installed /shared/ contents guards on ContentsManager (async={is_async_get})"
    )


def _sanitize_workspace_dict(ws: Any, allowed: Set[str]) -> bool:
    """Strip references to /shared/<X>/... paths where X isn't in `allowed`.
    Mutates `ws` in place. Returns True if anything changed."""
    data = ws.get("data") if isinstance(ws, dict) else None
    if not isinstance(data, dict):
        return False

    def is_stale_path(p: Any) -> bool:
        if not isinstance(p, str):
            return False
        head = _shared_head(p.strip("/"))
        return head is not None and head != "" and head not in allowed

    def is_stale_widget_id(widget_id: Any) -> bool:
        if not isinstance(widget_id, str) or ":" not in widget_id:
            return False
        _, wpath = widget_id.split(":", 1)
        return is_stale_path(wpath)

    def clean_area(area: Any) -> bool:
        if not isinstance(area, dict):
            return False
        changed = False
        dock = area.get("dock")
        if isinstance(dock, dict):
            widgets = dock.get("widgets")
            if isinstance(widgets, list):
                kept = [w for w in widgets if not is_stale_widget_id(w)]
                if len(kept) != len(widgets):
                    dock["widgets"] = kept
                    changed = True
            current = area.get("current")
            if isinstance(current, str) and is_stale_widget_id(current):
                area["current"] = None
                changed = True
            for child_key in ("children",):
                kids = dock.get(child_key)
                if isinstance(kids, list):
                    for c in kids:
                        if clean_area(c):
                            changed = True
        for nested in ("main", "down", "left", "right", "top", "bottom"):
            if nested in area and clean_area(area[nested]):
                changed = True
        return changed

    changed = False
    for key in list(data.keys()):
        if is_stale_widget_id(key):
            del data[key]
            changed = True

    layout = data.get("layout-restorer:data")
    if isinstance(layout, dict) and clean_area(layout):
        changed = True

    for cwd_key in ("file-browser-filebrowser:cwd", "filebrowser:cwd"):
        cwd = data.get(cwd_key)
        if isinstance(cwd, dict) and is_stale_path(cwd.get("path", "")):
            data[cwd_key] = {"path": ""}
            changed = True

    recents = data.get("docmanager:recents")
    if isinstance(recents, dict):
        for bucket in ("opened", "closed"):
            items = recents.get(bucket)
            if isinstance(items, list):
                kept = [
                    it for it in items
                    if not is_stale_path((it or {}).get("path", ""))
                ]
                if len(kept) != len(items):
                    recents[bucket] = kept
                    changed = True

    return changed


def _sanitize_workspaces_on_disk(server_app) -> None:
    """Clean saved workspace files at pod boot time."""
    ws_dir = os.path.expanduser("~/.jupyter/lab/workspaces")
    if not os.path.isdir(ws_dir):
        return
    try:
        allowed = _current_share_names()
    except Exception:
        return

    for fname in os.listdir(ws_dir):
        if not fname.endswith(".jupyterlab-workspace"):
            continue
        path = os.path.join(ws_dir, fname)
        try:
            with open(path) as f:
                ws = json.load(f)
        except Exception:
            continue
        if _sanitize_workspace_dict(ws, allowed):
            try:
                with open(path, "w") as f:
                    json.dump(ws, f)
                server_app.log.info(f"Sanitized stale /shared/ refs in {fname}")
            except Exception as e:
                server_app.log.warning(f"Could not rewrite {fname}: {e}")


def _install_workspace_guard(server_app) -> None:
    """Sanitize workspace JSON on every load so live revocations propagate
    without a pod restart. JupyterLab's file-browser reads the saved `cwd`
    and open-tab list from here on every browser reload."""
    try:
        from jupyterlab_server.workspaces_handler import WorkspacesManager
    except ImportError:
        server_app.log.info("jupyterlab_server.WorkspacesManager not available — skipping workspace guard")
        return

    orig_load = WorkspacesManager.load

    def load(self, space_name: str) -> dict:
        ws = orig_load(self, space_name)
        try:
            _sanitize_workspace_dict(ws, _current_share_names())
        except Exception as e:
            server_app.log.warning(f"Workspace sanitize failed for {space_name}: {e}")
        return ws

    WorkspacesManager.load = load
    server_app.log.info("Installed workspaces load-time /shared/ filter")


def _load_jupyter_server_extension(server_app):
    """Register API handlers, install /shared/ contents guards, and patch
    the workspaces manager so stale references to revoked shares don't
    trigger 'Directory not found' dialogs on browser reload."""
    setup_handlers(server_app.web_app)
    try:
        _install_contents_guards(server_app)
    except Exception as e:
        server_app.log.warning(f"Could not install contents guards: {e}")
    try:
        _sanitize_workspaces_on_disk(server_app)
    except Exception as e:
        server_app.log.warning(f"Could not sanitize workspaces on disk: {e}")
    try:
        _install_workspace_guard(server_app)
    except Exception as e:
        server_app.log.warning(f"Could not install workspace guard: {e}")
