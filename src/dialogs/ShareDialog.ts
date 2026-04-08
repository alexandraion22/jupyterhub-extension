import { Widget } from '@lumino/widgets';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export class ShareDialogBody extends Widget {
  private emailInput: HTMLInputElement;
  private rightsSelect: HTMLSelectElement;
  private errorSpan: HTMLSpanElement;

  constructor() {
    super({ node: document.createElement('div') });

    const emailLabel = document.createElement('label');
    emailLabel.textContent = 'Share with (email):';
    emailLabel.style.display = 'block';
    emailLabel.style.marginBottom = '5px';

    this.emailInput = document.createElement('input');
    this.emailInput.type = 'email';
    this.emailInput.placeholder = 'user@example.com';
    this.emailInput.style.width = '100%';
    this.emailInput.style.marginBottom = '5px';

    this.errorSpan = document.createElement('span');
    this.errorSpan.style.color = '#e74c3c';
    this.errorSpan.style.fontSize = '12px';
    this.errorSpan.style.display = 'none';
    this.errorSpan.style.marginBottom = '10px';

    const rightsLabel = document.createElement('label');
    rightsLabel.textContent = 'Access Rights:';
    rightsLabel.style.display = 'block';
    rightsLabel.style.marginBottom = '5px';
    rightsLabel.style.marginTop = '10px';

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
    this.node.appendChild(this.errorSpan);
    this.node.appendChild(rightsLabel);
    this.node.appendChild(this.rightsSelect);
  }

  validate(): boolean {
    const email = this.emailInput.value.trim();
    if (!email) {
      this.showError('Email is required.');
      return false;
    }
    if (!EMAIL_RE.test(email)) {
      this.showError('Please enter a valid email address.');
      return false;
    }
    this.hideError();
    return true;
  }

  getValue(): { email: string; rights: string } {
    return {
      email: this.emailInput.value.trim(),
      rights: this.rightsSelect.value
    };
  }

  private showError(msg: string): void {
    this.errorSpan.textContent = msg;
    this.errorSpan.style.display = 'block';
  }

  private hideError(): void {
    this.errorSpan.style.display = 'none';
  }
}
