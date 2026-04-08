import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { showDialog, Dialog, showErrorMessage } from '@jupyterlab/apputils';
import { buildIcon } from '@jupyterlab/ui-components';
import { Contents } from '@jupyterlab/services';

import { fetchApiToken, shareFolder, fetchPermissions, revokeAccess } from './api';
import { ShareDialogBody } from './dialogs/ShareDialog';
import { PermissionsDialogBody } from './dialogs/PermissionsDialog';

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

        const dialogBody = new ShareDialogBody();

        const result = await showDialog({
          title: `Share Folder: ${file.name}`,
          body: dialogBody,
          buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Share' })]
        });

        if (result.button.accept) {
          if (!dialogBody.validate()) {
            return;
          }

          const { email, rights } = dialogBody.getValue();

          try {
            const token = await fetchApiToken();
            if (!token) {
              void showErrorMessage(
                'Authentication Error',
                'Session expired or token unavailable. Please restart your server.'
              );
              return;
            }

            await shareFolder(file.name, email, rights, token);

            void showDialog({
              title: 'Success',
              body: `Successfully shared folder "${file.name}" with ${email}.`,
              buttons: [Dialog.okButton()]
            });
          } catch (error) {
            void showErrorMessage(
              'Sharing Failed',
              error instanceof Error ? error.message : String(error)
            );
          }
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

        // Load permissions asynchronously
        fetchPermissions(file.name, token)
          .then(data => {
            dialogBody.setPermissions(data.permissions, data.owner);
            dialogBody.onRevoke = async (userEmail: string) => {
              await revokeAccess(data.volume_name, userEmail, token);
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
  }
};

export default extension;
