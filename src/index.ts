import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { showDialog, Dialog, showErrorMessage } from '@jupyterlab/apputils';
import { buildIcon } from '@jupyterlab/ui-components';
import { Contents } from '@jupyterlab/services';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';

import {
  fetchApiToken,
  shareFolder,
  fetchPermissions,
  revokeAccess,
  fetchMyShares,
  fetchMe,
  acceptShare,
  buildShareLink,
  deleteVolume,
  AccessLevel,
  GeneralAccess,
  Permission,
  ShareSummary
} from './api';
import { ShareDialogBody, ShareController } from './dialogs/ShareDialog';
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
      caption: 'Share this folder and manage access',
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

        // Snapshot of the share (if any) as it exists at dialog-open time.
        // As the user mutates things the controller refreshes these.
        let volumeName: string | null = null;
        let generalAccess: GeneralAccess = 'restricted';
        let linkAccessLevel: AccessLevel = 'read';
        let existingPermissions: Permission[] = [];

        const existing = myShares.find(
          s => s.is_owner && s.display_name === file.name
        );
        if (existing) {
          volumeName = existing.volume_name;
          generalAccess = existing.general_access;
          linkAccessLevel = existing.link_access_level;
          try {
            const perms = await fetchPermissions(file.name, token);
            existingPermissions = perms.permissions;
          } catch (err) {
            console.warn('Could not load existing permissions:', err);
          }
        }

        // Declared before controller so the controller can call
        // dialogBody.refreshLinkState() after state changes.
        let dialogBody: ShareDialogBody;

        const controller: ShareController = {
          upsertRecipient: async (email, role) => {
            const response = await shareFolder(
              {
                directoryName: file.name,
                recipients: [{ email, role }],
                generalAccess,
                linkAccessLevel
              },
              token
            );
            volumeName = response.volume_name;
            generalAccess = response.general_access;
            linkAccessLevel = response.link_access_level;
            await refreshShares();
            dialogBody.refreshLinkState();
            return buildShareLink(volumeName);
          },
          revokeRecipient: async email => {
            if (!volumeName) {
              return;
            }
            await revokeAccess(volumeName, email, token);
            await refreshShares();
          },
          setGeneralAccess: async (mode, level) => {
            const response = await shareFolder(
              {
                directoryName: file.name,
                recipients: [],
                generalAccess: mode,
                linkAccessLevel: level
              },
              token
            );
            volumeName = response.volume_name;
            generalAccess = response.general_access;
            linkAccessLevel = response.link_access_level;
            await refreshShares();
            dialogBody.refreshLinkState();
            return buildShareLink(volumeName);
          },
          currentShareLink: () =>
            volumeName ? buildShareLink(volumeName) : null,
          ensureShareLink: async () => {
            // Create the volume on demand so a link can be generated without
            // first adding any recipient.
            if (!volumeName) {
              const response = await shareFolder(
                {
                  directoryName: file.name,
                  recipients: [],
                  generalAccess,
                  linkAccessLevel
                },
                token
              );
              volumeName = response.volume_name;
              generalAccess = response.general_access;
              linkAccessLevel = response.link_access_level;
              await refreshShares();
              dialogBody.refreshLinkState();
            }
            return volumeName ? buildShareLink(volumeName) : null;
          }
        };

        dialogBody = new ShareDialogBody(
          file.name,
          ownerDomain,
          generalAccess,
          linkAccessLevel,
          existingPermissions,
          myEmail,
          controller
        );

        await showDialog({
          title: `Share "${file.name}"`,
          body: dialogBody,
          buttons: [Dialog.okButton({ label: 'Done' })]
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

    // --- Cascade delete: when the owner deletes a shared source folder,
    // tear the share down so it disappears for every recipient too. ---
    app.serviceManager.contents.fileChanged.connect(async (_, change) => {
      if (change.type !== 'delete') {
        return;
      }
      const oldPath = (change.oldValue?.path ?? '').replace(/^\/+|\/+$/g, '');
      // Shares are created from a top-level folder name; only those can match.
      if (!oldPath || oldPath.includes('/') || oldPath.startsWith('shared')) {
        return;
      }
      const owned = myShares.find(
        s => s.is_owner && s.display_name === oldPath
      );
      if (!owned) {
        return;
      }
      const token = await fetchApiToken();
      if (!token) {
        return;
      }
      try {
        await deleteVolume(owned.volume_name, token);
        await refreshShares();
      } catch (err) {
        console.warn('Failed to remove share for deleted folder:', err);
      }
    });

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
            (res as unknown as { display_name?: string }).display_name ??
              'the shared folder'
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

// --- Logged-in user indicator in the top-right corner ---
// Renders the user's email as text next to the collaboration avatar.
// Source order: native JupyterLab identity (instant, no network) first,
// then refined via the sharing API's /me (authoritative email) if reachable.
const userIndicator: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab-examples/context-menu:user-indicator',
  description: 'Shows the logged-in user email in the top bar.',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    const node = document.createElement('div');
    node.className = 'jp-UserEmailIndicator';
    const widget = new Widget({ node });
    widget.id = 'jp-user-email-indicator';

    const setEmail = (email: string): void => {
      if (!email) {
        return;
      }
      node.textContent = email;
      node.title = email;
    };

    // 1. Instant: JupyterLab's own user identity. Under JupyterHub the
    //    username is the SAML `mail` attribute, i.e. the email.
    const userManager = app.serviceManager.user;
    const renderFromIdentity = (): void => {
      const identity = userManager.identity;
      setEmail(identity?.username || identity?.name || '');
    };
    void userManager.ready.then(renderFromIdentity);
    userManager.userChanged.connect(renderFromIdentity);

    // 2. Authoritative: the sharing API's /me endpoint.
    void fetchMe().then(me => {
      if (me?.email) {
        setEmail(me.email);
      }
    });

    // rank just below the collaboration user menu (1000) so this text
    // sits immediately to the left of the avatar in the right cluster.
    app.shell.add(widget, 'top', { rank: 999 });
  }
};

// --- Remove the Table of Contents and Collaboration left-sidebar panels ---
const trimSidebar: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab-examples/context-menu:trim-sidebar',
  description: 'Removes the Table of Contents and Collaboration left panels.',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    const shouldRemove = (w: Widget): boolean =>
      w.id.includes('table-of-contents') ||
      w.id.includes('collaboration') ||
      w.hasClass('jp-CollaboratorsPanel');
    const trim = (): void => {
      for (const w of Array.from(app.shell.widgets('left'))) {
        if (shouldRemove(w)) {
          w.dispose();
        }
      }
    };
    void app.restored.then(trim);
  }
};

// --- Google-Colab-style run button on the left of each code cell ---
// Clicking a code cell's input prompt (the `[ ]:` gutter) runs the cell.
// CSS turns the gutter into a play button on hover (see style/base.css).
const colabRunButton: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab-examples/context-menu:colab-run',
  description: 'Run a code cell by clicking a play button in its left gutter.',
  autoStart: true,
  requires: [INotebookTracker],
  activate: (app: JupyterFrontEnd, tracker: INotebookTracker) => {
    tracker.widgetAdded.connect((_, panel) => {
      const notebook = panel.content;
      panel.node.addEventListener(
        'click',
        (event: MouseEvent) => {
          const target = event.target as HTMLElement | null;
          if (!target?.closest('.jp-InputArea-prompt')) {
            return;
          }
          const cellNode = target.closest('.jp-Cell');
          if (!cellNode) {
            return;
          }
          const idx = notebook.widgets.findIndex(w => w.node === cellNode);
          if (idx < 0 || notebook.widgets[idx].model.type !== 'code') {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          notebook.activeCellIndex = idx;
          void NotebookActions.run(notebook, panel.sessionContext);
        },
        true
      );
    });
  }
};

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
    const origin = window.location.origin;
    window.location.href = `${origin}/hub/home`;
  }
}

export default [extension, userIndicator, trimSidebar, colabRunButton];
