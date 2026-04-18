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
  ShareSummary
} from './api';
import { ShareDialogBody } from './dialogs/ShareDialog';
import { PermissionsDialogBody } from './dialogs/PermissionsDialog';
import { SharedWithMePanel } from './widgets/SharedWithMePanel';

const SHARE_LINK_PARAM = 'share-link';

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
        await app.commands.execute('filebrowser:open-path', { path });
      } catch (err) {
        void showErrorMessage(
          'Could not open folder',
          `The folder will appear after you restart your server.\n\n(${
            err instanceof Error ? err.message : String(err)
          })`
        );
      }
    });

    // --- Share Folder command ---
    app.commands.addCommand('jlab-examples/context-menu:share', {
      label: 'Share Folder',
      caption: 'Share this folder with another user',
      icon: buildIcon,
      isEnabled: () => isDirectory(getSelectedItem()),
      isVisible: () => isDirectory(getSelectedItem()),
      execute: async () => {
        const file = getSelectedItem();
        if (!file || !isDirectory(file)) {
          return;
        }

        const existing = myShares.find(
          s => s.is_owner && s.display_name === file.name
        );
        const shareLink = existing ? buildShareLink(existing.volume_name) : null;

        const dialogBody = new ShareDialogBody(
          file.name,
          ownerDomain,
          shareLink,
          existing?.general_access ?? 'restricted',
          existing?.link_access_level ?? 'read'
        );

        const result = await showDialog({
          title: `Share "${file.name}"`,
          body: dialogBody,
          buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Save' })]
        });

        if (!result.button.accept || !dialogBody.validate()) {
          return;
        }

        const { recipients, generalAccess, linkAccessLevel } = dialogBody.getValue();

        try {
          const token = await fetchApiToken();
          if (!token) {
            void showErrorMessage(
              'Authentication Error',
              'Session expired or token unavailable. Please restart your server.'
            );
            return;
          }

          const response = await shareFolder(
            {
              directoryName: file.name,
              recipients,
              generalAccess,
              linkAccessLevel
            },
            token
          );

          await refreshShares();

          const link = buildShareLink(response.volume_name);
          const messageLines: string[] = [];
          if (response.added.length) {
            messageLines.push(
              `Shared with: ${response.added.join(', ')}.`
            );
          }
          if (generalAccess === 'domain' && ownerDomain) {
            messageLines.push(
              `Anyone at ${ownerDomain} can now ${
                linkAccessLevel === 'write' ? 'edit' : 'view'
              } this folder.`
            );
            messageLines.push(`Link: ${link}`);
          }
          messageLines.push(
            'Recipients will see the folder under /shared/ after restarting their server.'
          );

          void showDialog({
            title: 'Share saved',
            body: messageLines.join('\n\n'),
            buttons: [Dialog.okButton()]
          });
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
        // Only decorate items at the owner's home root; deeper paths aren't
        // tracked in our share model.
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
        void showDialog({
          title: 'Share joined',
          body: res.message,
          buttons: [Dialog.okButton()]
        });
        await refreshShares();
      } catch (err) {
        void showErrorMessage(
          'Could not join share',
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        // Remove the query param so a page reload doesn't re-trigger.
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
      }
      await handleShareLink();
      await refreshShares();
    })();
  }
};

export default extension;
