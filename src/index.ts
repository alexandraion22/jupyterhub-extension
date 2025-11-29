import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { showDialog, Dialog } from '@jupyterlab/apputils';
import { buildIcon } from '@jupyterlab/ui-components';
import { Contents } from '@jupyterlab/services';

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
      execute: () => {
        const file = getSelectedItem();
        if (!file || !isRootDirectory(file)) {
          return;
        }
        showDialog({
          title: file.name,
          body: 'Path: ' + file.path,
          buttons: [Dialog.okButton()]
        }).catch(e => console.log(e));
      }
    });
  }
};

export default extension;
