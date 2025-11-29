import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { showDialog, Dialog } from '@jupyterlab/apputils';
import { buildIcon } from '@jupyterlab/ui-components';
import { Contents, ServerConnection } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';

class ShareForm extends Widget {
  constructor() {
    super({ node: document.createElement('div') });
    this.addClass('jp-ShareForm');
    
    const emailLabel = document.createElement('label');
    emailLabel.textContent = 'User Email:';
    emailLabel.style.display = 'block';
    emailLabel.style.marginBottom = '5px';
    
    const emailInput = document.createElement('input');
    emailInput.type = 'email';
    emailInput.placeholder = 'user@example.com';
    emailInput.style.width = '100%';
    emailInput.style.marginBottom = '15px';
    this.emailNode = emailInput;

    const accessLabel = document.createElement('label');
    accessLabel.textContent = 'Access Level:';
    accessLabel.style.display = 'block';
    accessLabel.style.marginBottom = '5px';
    
    const accessSelect = document.createElement('select');
    accessSelect.style.width = '100%';
    const readOption = document.createElement('option');
    readOption.value = 'read';
    readOption.textContent = 'Read Only';
    const writeOption = document.createElement('option');
    writeOption.value = 'write';
    writeOption.textContent = 'Read & Write';
    accessSelect.appendChild(readOption);
    accessSelect.appendChild(writeOption);
    this.accessNode = accessSelect;

    this.node.appendChild(emailLabel);
    this.node.appendChild(emailInput);
    this.node.appendChild(accessLabel);
    this.node.appendChild(accessSelect);
  }

  readonly emailNode: HTMLInputElement;
  readonly accessNode: HTMLSelectElement;

  getValue() {
    return {
      target_email: this.emailNode.value,
      access_level: this.accessNode.value
    };
  }
}

// Removed unused fetchGoogleToken

const shareVolume = async (
  volumeName: string,
  targetEmail: string,
  accessLevel: string
): Promise<void> => {
  const settings = ServerConnection.makeSettings();
  try {
    const response = await ServerConnection.makeRequest(
      `${settings.baseUrl}jlab-examples/share`,
      {
        method: 'POST',
        body: JSON.stringify({
          volume_name: volumeName,
          target_email: targetEmail,
          access_level: accessLevel
        })
      },
      settings
    );

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || response.statusText);
    }

    await showDialog({
      title: 'Success',
      body: `Successfully shared ${volumeName} with ${targetEmail}`,
      buttons: [Dialog.okButton()]
    });
  } catch (error: any) {
    console.error('Error sharing volume', error);
    await showDialog({
      title: 'Error',
      body: `Failed to share volume: ${error.message || error}`,
      buttons: [Dialog.okButton()]
    });
  }
};

const extension: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab-examples/context-menu:plugin',
  description: 'Context menu to share volumes.',
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
      label: 'Share Volume',
      caption: "Share this volume with another user",
      icon: buildIcon,
      isEnabled: () => isRootDirectory(getSelectedItem()),
      isVisible: () => isRootDirectory(getSelectedItem()),
      execute: async () => {
        const file = getSelectedItem();
        if (!file || !isRootDirectory(file)) {
          return;
        }

        const dialogBody = new ShareForm();
        const result = await showDialog({
          title: `Share Volume: ${file.name}`,
          body: dialogBody,
          buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Share' })]
        });

        if (result.button.accept) {
          const formData = dialogBody.getValue();
          if (!formData.target_email) {
            await showDialog({
              title: 'Error',
              body: 'Email is required.',
              buttons: [Dialog.okButton()]
            });
            return;
          }
          await shareVolume(file.name, formData.target_email, formData.access_level);
        }
      }
    });
  }
};

export default extension;
