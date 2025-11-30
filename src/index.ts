import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { showDialog, Dialog } from '@jupyterlab/apputils';
import { buildIcon } from '@jupyterlab/ui-components';
import { Contents, ServerConnection } from '@jupyterlab/services';

const fetchGoogleToken = async (): Promise<string | null> => {
  const settings = ServerConnection.makeSettings();
  try {
    const response = await ServerConnection.makeRequest(
      `${settings.baseUrl}jlab-examples/google-token`,
      {},
      settings
    );

    if (!response.ok) {
      console.error('Failed to fetch Google token', response.statusText);
      return null;
    }

    const data = (await response.json()) as { token?: string };
    return data.token ?? null;
  } catch (error) {
    console.error('Error while requesting Google token', error);
    return null;
  }
};

const extension: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab-examples/context-menu:plugin',
  description: 'A minimal JupyterLab example to develop a context-menu.',
  autoStart: true,
  requires: [IFileBrowserFactory],
  activate: (app: JupyterFrontEnd, factory: IFileBrowserFactory) => {
    const getSelectedItem = (): Contents.IModel | undefined =>
      factory.tracker.currentWidget?.selectedItems().next()?.value;

    const isRootDirectory = (item: Contents.IModel | undefined): boolean => {
      if (!item) {
        return false;
      }

      return item.type === 'directory' && !item.path.includes('/');
    };

    app.commands.addCommand('jlab-examples/context-menu:open', {
      label: 'Example',
      caption: "Example context menu button for file browser's items.",
      icon: buildIcon,
      isEnabled: () => isRootDirectory(getSelectedItem()),
      isVisible: () => isRootDirectory(getSelectedItem()),
      execute: async () => {
        const file = getSelectedItem();
        if (!file || !isRootDirectory(file)) {
          return;
        }
        const token = await fetchGoogleToken();
        const tokenMessage = token
          ? `Google token: ${token}`
          : 'Google token is not available.';
        void showDialog({
          title: file.name,
          body: `Path: ${file.path}\n${tokenMessage}`,
          buttons: [Dialog.okButton()]
        }).catch(e => console.log(e));
      }
    });
  }
};

export default extension;
