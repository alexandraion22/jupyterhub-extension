import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { showDialog, Dialog, showErrorMessage } from '@jupyterlab/apputils';
import { buildIcon } from '@jupyterlab/ui-components';
import { Contents } from '@jupyterlab/services';

import {
  fetchApiToken,
  shareFolder,
  fetchPermissions,
  revokeAccess,
  fetchMyShares,
  fetchMe,
  acceptShare,
  buildShareLink,
  Permission,
  ShareSummary
} from './api';
import { Widget } from '@lumino/widgets';
import { ShareDialogBody } from './dialogs/ShareDialog';
import { PermissionsDialogBody } from './dialogs/PermissionsDialog';
import { SharedWithMePanel } from './widgets/SharedWithMePanel';

const SHARE_LINK_PARAM = 'share-link';

function isInManagedSharedTree(item: Contents.IModel | undefined): boolean {
  if (!item) {
    return false;
  }
  const path = item.path.replace(/^\/+|\/+$/g, '');
  return path === 'shared' || path.startsWith('shared/');
}

const extension: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab-examples/context-menu:plugin',
  description: 'JupyterLab extension for folder sharing and permissions management.',
  autoStart: true,
  requires: [IFileBrowserFactory],
  activate: (app: JupyterFrontEnd, factory: IFileBrowserFactory) => {
    const getSelectedItem = (): Contents.IModel | undefined =>
      factory.tracker.currentWidget?.selectedItems().next()?.value;

    const isDirectory = (item: Contents.IModel | undefined): boolean =>
      item?.type === 'directory';

    // --- Shared-with-me sidebar ---
    const sharesPanel = new SharedWithMePanel();
    app.shell.add(sharesPanel, 'left', { rank: 900 });

    let ownerDomain = '';
    let myEmail = '';
    let myShares: ShareSummary[] = [];

    const refreshShares = async (): Promise<void> => {
      const token = await fetchApiToken();
      if (!token) {
        sharesPanel.setError('Sign-in token unavailable.');
        return;
      }
      try {
        const data = await fetchMyShares(token);
        myShares = data.shares;
        sharesPanel.setShares(myShares);
        applyShareIndicators();
      } catch (err) {
        sharesPanel.setError(
          err instanceof Error ? err.message : 'Failed to load shares.'
        );
      }
    };

    sharesPanel.refreshRequested.connect(() => {
      void refreshShares();
    });

    sharesPanel.openRequested.connect(async (_, { share }) => {
      const path = share.is_owner
        ? share.display_name
        : `shared/${share.display_name}`;
      // Check the path exists before calling open-path. Shares that were
      // granted after this pod spawned don't have a mount yet — the user
      // must restart the server so KubeSpawner picks up the new volume.
      try {
        await app.serviceManager.contents.get(path, { content: false });
      } catch {
        await promptServerRestart(share.display_name);
        return;
      }
      try {
        await app.commands.execute('filebrowser:open-path', { path });
      } catch (err) {
        void showErrorMessage(
          'Could not open folder',
          err instanceof Error ? err.message : String(err)
        );
      }
    });

    // --- Share Folder command ---
    app.commands.addCommand('jlab-examples/context-menu:share', {
      label: 'Share Folder',
      caption: 'Share this folder with another user',
      icon: buildIcon,
      isEnabled: () => {
        const item = getSelectedItem();
        return isDirectory(item) && !isInManagedSharedTree(item);
      },
      isVisible: () => {
        const item = getSelectedItem();
        return isDirectory(item) && !isInManagedSharedTree(item);
      },
      execute: async () => {
        const file = getSelectedItem();
        if (!file || !isDirectory(file) || isInManagedSharedTree(file)) {
          return;
        }

        const token = await fetchApiToken();
        if (!token) {
          void showErrorMessage(
            'Authentication Error',
            'Session expired or token unavailable. Please restart your server.'
          );
          return;
        }

        const existing = myShares.find(
          s => s.is_owner && s.display_name === file.name
        );
        const shareLink = existing ? buildShareLink(existing.volume_name) : null;

        // If already shared, pull the current ACL so the dialog can render
        // existing people with role dropdowns + remove buttons.
        let existingPermissions: Permission[] = [];
        if (existing) {
          try {
            const perms = await fetchPermissions(file.name, token);
            existingPermissions = perms.permissions;
          } catch (err) {
            console.warn('Could not load existing permissions:', err);
          }
        }

        const dialogBody = new ShareDialogBody(
          file.name,
          ownerDomain,
          shareLink,
          existing?.general_access ?? 'restricted',
          existing?.link_access_level ?? 'read',
          existingPermissions,
          myEmail
        );

        const result = await showDialog({
          title: `Share "${file.name}"`,
          body: dialogBody,
          buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Save' })]
        });

        if (!result.button.accept || !dialogBody.validate()) {
          return;
        }

        const { recipients, removed, generalAccess, linkAccessLevel } =
          dialogBody.getValue();

        try {
          // We always call shareFolder so general-access changes propagate
          // even when no recipients are being added/updated. The backend
          // upserts on `recipients` and treats an empty array as a no-op.
          const response = await shareFolder(
            {
              directoryName: file.name,
              recipients,
              generalAccess,
              linkAccessLevel
            },
            token
          );

          // Apply removals last so we don't briefly lose access
          // intermediate-state.
          for (const email of removed) {
            try {
              await revokeAccess(response.volume_name, email, token);
            } catch (err) {
              console.warn(`Revoke failed for ${email}:`, err);
            }
          }

          await refreshShares();

          const link = buildShareLink(response.volume_name);
          const messages: string[] = [];
          if (recipients.length) {
            messages.push(
              `Added / updated: ${recipients.map(r => r.email).join(', ')}.`
            );
          }
          if (removed.length) {
            messages.push(`Removed: ${removed.join(', ')}.`);
          }
          if (generalAccess === 'domain' && ownerDomain) {
            messages.push(
              `Anyone at ${ownerDomain} can ${
                linkAccessLevel === 'write' ? 'edit' : 'view'
              } this folder via the link.`
            );
          }
          messages.push(
            'Recipients will see the folder under /shared/ after restarting their server.'
          );

          await showSuccessDialog(
            messages.join('\n\n'),
            generalAccess === 'domain' ? link : null
          );
        } catch (error) {
          void showErrorMessage(
            'Sharing Failed',
            error instanceof Error ? error.message : String(error)
          );
        }
      }
    });

    // --- View Permissions command ---
    app.commands.addCommand('jlab-examples/context-menu:view-permissions', {
      label: 'View Permissions',
      caption: 'View who has access to this folder',
      icon: buildIcon,
      isEnabled: () => isDirectory(getSelectedItem()),
      isVisible: () => isDirectory(getSelectedItem()),
      execute: async () => {
        const file = getSelectedItem();
        if (!file || !isDirectory(file)) {
          return;
        }

        const token = await fetchApiToken();
        if (!token) {
          void showErrorMessage(
            'Authentication Error',
            'Session expired or token unavailable. Please restart your server.'
          );
          return;
        }

        const dialogBody = new PermissionsDialogBody();

        fetchPermissions(file.name, token)
          .then(data => {
            dialogBody.setPermissions(data.permissions, data.owner);
            dialogBody.onRevoke = async (userEmail: string) => {
              await revokeAccess(data.volume_name, userEmail, token);
              await refreshShares();
            };
          })
          .catch(err => {
            const msg =
              err instanceof Error ? err.message : 'Failed to load permissions';
            dialogBody.setError(msg);
          });

        await showDialog({
          title: `Permissions: ${file.name}`,
          body: dialogBody,
          buttons: [Dialog.okButton({ label: 'Close' })]
        });
      }
    });

    // --- Share indicator in file browser ---
    const applyShareIndicators = (): void => {
      const widget = factory.tracker.currentWidget;
      if (!widget) {
        return;
      }
      const ownedNames = new Set(
        myShares.filter(s => s.is_owner).map(s => s.display_name)
      );
      const currentPath = widget.model.path;
      const items = widget.node.querySelectorAll('.jp-DirListing-item');
      items.forEach(item => {
        const textEl = item.querySelector(
          '.jp-DirListing-itemText'
        ) as HTMLElement | null;
        const name = textEl?.textContent?.trim();
        const shouldDecorate =
          !!name && currentPath === '' && ownedNames.has(name);
        item.classList.toggle('jp-shared-folder', shouldDecorate);
      });
    };

    const attachBrowserSignals = (): void => {
      const widget = factory.tracker.currentWidget;
      if (!widget) {
        return;
      }
      widget.model.pathChanged.connect(applyShareIndicators);
      widget.model.refreshed.connect(applyShareIndicators);
      applyShareIndicators();
    };
    factory.tracker.currentChanged.connect(attachBrowserSignals);
    attachBrowserSignals();

    // --- Auto-accept ?share-link= on boot ---
    const handleShareLink = async (): Promise<void> => {
      const params = new URLSearchParams(window.location.search);
      const volume = params.get(SHARE_LINK_PARAM);
      if (!volume) {
        return;
      }
      const token = await fetchApiToken();
      if (!token) {
        return;
      }
      try {
        const res = await acceptShare(volume, token);
        await refreshShares();
        // The share was recorded, but the mount only takes effect on the
        // next pod spawn. Prompt the user to restart right away.
        const alreadyMember = (res as unknown as { already_member?: boolean })
          .already_member;
        if (alreadyMember) {
          void showDialog({
            title: 'Share link',
            body: res.message,
            buttons: [Dialog.okButton()]
          });
        } else {
          await promptServerRestart(
            (res as unknown as { display_name?: string }).display_name ?? 'the shared folder'
          );
        }
      } catch (err) {
        void showErrorMessage(
          'Could not join share',
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        params.delete(SHARE_LINK_PARAM);
        const newSearch = params.toString();
        const newUrl =
          window.location.pathname +
          (newSearch ? `?${newSearch}` : '') +
          window.location.hash;
        window.history.replaceState({}, '', newUrl);
      }
    };

    // --- Boot ---
    void (async () => {
      const me = await fetchMe();
      if (me) {
        ownerDomain = me.domain;
        myEmail = me.email;
      }
      await handleShareLink();
      await refreshShares();
    })();
  }
};

/**
 * Success dialog with a copyable link when general access = domain.
 * The link lives in a readonly <input> so the user can click it and Cmd/Ctrl+A
 * selects the whole thing even when clipboard APIs fail.
 */
async function showSuccessDialog(
  messageText: string,
  link: string | null
): Promise<void> {
  const body = document.createElement('div');
  body.style.fontSize = '13px';
  body.style.minWidth = '420px';

  for (const line of messageText.split('\n\n')) {
    const p = document.createElement('p');
    p.textContent = line;
    p.style.margin = '0 0 8px';
    body.appendChild(p);
  }

  if (link) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.marginTop = '8px';

    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.value = link;
    input.style.flex = '1';
    input.style.fontSize = '12px';
    input.style.padding = '4px 6px';
    input.addEventListener('focus', () => input.select());

    const btn = document.createElement('button');
    btn.textContent = 'Copy link';
    btn.style.cursor = 'pointer';
    btn.style.padding = '3px 10px';
    btn.addEventListener('click', async () => {
      const ok = await copyToClipboardUniversal(link);
      btn.textContent = ok ? 'Copied!' : 'Copy failed';
      setTimeout(() => {
        btn.textContent = 'Copy link';
      }, 1500);
    });

    row.appendChild(input);
    row.appendChild(btn);
    body.appendChild(row);
  }

  const widget = new Widget({ node: body });

  await showDialog({
    title: 'Share saved',
    body: widget,
    buttons: [Dialog.okButton()]
  });
}

async function promptServerRestart(folderName: string): Promise<void> {
  const result = await showDialog({
    title: 'Restart server to mount shared folder',
    body:
      `"${folderName}" will appear under /shared/ only after your server restarts — ` +
      `KubeSpawner wires shared volumes at spawn time.\n\n` +
      `Restart now? You'll be taken to the JupyterHub control panel to stop and start ` +
      `your server. Save any unsaved work first.`,
    buttons: [
      Dialog.cancelButton({ label: 'Later' }),
      Dialog.okButton({ label: 'Open control panel' })
    ]
  });
  if (result.button.accept) {
    // /hub/home has explicit Stop/Start buttons and is the most reliable
    // path across JupyterHub versions. Avoids a silent API restart which
    // would drop unsaved notebook state without warning.
    const origin = window.location.origin;
    window.location.href = `${origin}/hub/home`;
  }
}

async function copyToClipboardUniversal(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default extension;
