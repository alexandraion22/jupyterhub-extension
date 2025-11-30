import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IFileBrowserFactory } from '@jupyterlab/filebrowser';
import { showDialog, Dialog, showErrorMessage } from '@jupyterlab/apputils';
import { buildIcon } from '@jupyterlab/ui-components';
import { Contents, ServerConnection } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';

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

const shareFolder = async (
  directoryName: string,
  shareWithUser: string,
  accessRights: string,
  token: string
): Promise<any> => {
  const settings = ServerConnection.makeSettings();
  try {
    const response = await ServerConnection.makeRequest(
      `${settings.baseUrl}jlab-examples/share`,
      {
        method: 'POST',
        body: JSON.stringify({
          directory_name: directoryName,
          share_with_user: shareWithUser,
          access_rights: accessRights,
          token: token
        })
      },
      settings
    );

    if (!response.ok) {
      throw new Error(`Failed to share folder: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error sharing folder', error);
    throw error;
  }
};

/**
 * A widget for the share dialog body
 */
class ShareDialogBody extends Widget {
  constructor() {
    super({ node: document.createElement('div') });
    
    const emailLabel = document.createElement('label');
    emailLabel.textContent = 'Share with (email):';
    emailLabel.style.display = 'block';
    emailLabel.style.marginBottom = '5px';
    
    this.emailInput = document.createElement('input');
    this.emailInput.type = 'email';
    this.emailInput.style.width = '100%';
    this.emailInput.style.marginBottom = '15px';
    
    const rightsLabel = document.createElement('label');
    rightsLabel.textContent = 'Access Rights:';
    rightsLabel.style.display = 'block';
    rightsLabel.style.marginBottom = '5px';
    
    this.rightsSelect = document.createElement('select');
    this.rightsSelect.style.width = '100%';
    
    const readOption = document.createElement('option');
    readOption.value = 'read';
    readOption.textContent = 'Read Only';
    readOption.selected = true;
    
    const writeOption = document.createElement('option');
    writeOption.value = 'write';
    writeOption.textContent = 'Read & Write';
    
    this.rightsSelect.appendChild(readOption);
    this.rightsSelect.appendChild(writeOption);
    
    this.node.appendChild(emailLabel);
    this.node.appendChild(this.emailInput);
    this.node.appendChild(rightsLabel);
    this.node.appendChild(this.rightsSelect);
  }

  getValue(): { email: string, rights: string } {
    return {
      email: this.emailInput.value,
      rights: this.rightsSelect.value
    };
  }

  private emailInput: HTMLInputElement;
  private rightsSelect: HTMLSelectElement;
}

const extension: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab-examples/context-menu:plugin',
  description: 'A minimal JupyterLab example to develop a context-menu.',
  autoStart: true,
  requires: [IFileBrowserFactory],
  activate: (app: JupyterFrontEnd, factory: IFileBrowserFactory) => {
    const getSelectedItem = (): Contents.IModel | undefined =>
      factory.tracker.currentWidget?.selectedItems().next()?.value;

    // Modified to allow sharing any directory, not just root
    const isDirectory = (item: Contents.IModel | undefined): boolean => {
      if (!item) {
        return false;
      }
      return item.type === 'directory';
    };

    app.commands.addCommand('jlab-examples/context-menu:share', {
      label: 'Share Folder',
      caption: "Share this folder with another user",
      icon: buildIcon,
      isEnabled: () => isDirectory(getSelectedItem()),
      isVisible: () => isDirectory(getSelectedItem()),
      execute: async () => {
        const file = getSelectedItem();
        if (!file || !isDirectory(file)) {
          return;
        }
        
        // Create the dialog body widget
        const dialogBody = new ShareDialogBody();
        
        const result = await showDialog({
          title: `Share Folder: ${file.name}`,
          body: dialogBody,
          buttons: [Dialog.cancelButton(), Dialog.okButton({ label: 'Share' })]
        });

        if (result.button.accept) {
          const { email, rights } = dialogBody.getValue();
          
          if (!email) {
             void showErrorMessage('Error', 'Email is required.');
             return;
          }

          try {
            const token = await fetchGoogleToken();
            // Even if token is null, we might want to proceed? 
            // The user said "send the auth token", implying it's required.
            // If token is missing, we can send empty string or fail.
            
            await shareFolder(file.name, email, rights, token || '');
            
            void showDialog({
              title: 'Success',
              body: `Successfully shared folder "${file.name}" with ${email}.`,
              buttons: [Dialog.okButton()]
            });
            
          } catch (error) {
            void showErrorMessage('Sharing Failed', error instanceof Error ? error.message : String(error));
          }
        }
      }
    });
  }
};

export default extension;
