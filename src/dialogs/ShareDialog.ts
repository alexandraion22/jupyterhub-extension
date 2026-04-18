import { Widget } from '@lumino/widgets';
import {
  AccessLevel,
  GeneralAccess,
  Recipient,
  Role
} from '../api';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface ShareDialogResult {
  recipients: Recipient[];
  generalAccess: GeneralAccess;
  linkAccessLevel: AccessLevel;
}

interface RecipientRow {
  container: HTMLDivElement;
  email: string;
  role: Role;
}

export class ShareDialogBody extends Widget {
  private emailInput: HTMLInputElement;
  private roleSelect: HTMLSelectElement;
  private chipsContainer: HTMLDivElement;
  private errorSpan: HTMLSpanElement;
  private generalAccessSelect: HTMLSelectElement;
  private linkRoleSelect: HTMLSelectElement;
  private linkHint: HTMLSpanElement;
  private copyLinkBtn: HTMLButtonElement;
  private rows: RecipientRow[] = [];

  constructor(
    private readonly folderName: string,
    private readonly ownerDomain: string,
    private readonly shareLink: string | null,
    initialGeneralAccess: GeneralAccess = 'restricted',
    initialLinkAccess: AccessLevel = 'read'
  ) {
    super({ node: document.createElement('div') });
    this.node.style.minWidth = '460px';
    this.node.style.fontSize = '13px';

    const heading = document.createElement('div');
    heading.textContent = 'Add people';
    heading.style.fontWeight = '600';
    heading.style.marginBottom = '6px';
    this.node.appendChild(heading);

    const addRow = document.createElement('div');
    addRow.style.display = 'flex';
    addRow.style.gap = '6px';
    addRow.style.marginBottom = '8px';

    this.emailInput = document.createElement('input');
    this.emailInput.type = 'email';
    this.emailInput.placeholder = 'Email address';
    this.emailInput.style.flex = '1';
    this.emailInput.style.padding = '4px 6px';
    this.emailInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
        e.preventDefault();
        this.commitCurrentInput();
      }
    });

    this.roleSelect = this.buildRoleSelect('viewer');

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.style.cursor = 'pointer';
    addBtn.addEventListener('click', e => {
      e.preventDefault();
      this.commitCurrentInput();
    });

    addRow.appendChild(this.emailInput);
    addRow.appendChild(this.roleSelect);
    addRow.appendChild(addBtn);
    this.node.appendChild(addRow);

    this.errorSpan = document.createElement('span');
    this.errorSpan.style.color = '#e74c3c';
    this.errorSpan.style.fontSize = '12px';
    this.errorSpan.style.display = 'none';
    this.errorSpan.style.marginBottom = '8px';
    this.node.appendChild(this.errorSpan);

    this.chipsContainer = document.createElement('div');
    this.chipsContainer.style.display = 'flex';
    this.chipsContainer.style.flexDirection = 'column';
    this.chipsContainer.style.gap = '4px';
    this.chipsContainer.style.marginBottom = '14px';
    this.chipsContainer.style.maxHeight = '180px';
    this.chipsContainer.style.overflowY = 'auto';
    this.node.appendChild(this.chipsContainer);

    const divider = document.createElement('hr');
    divider.style.border = 'none';
    divider.style.borderTop = '1px solid #ddd';
    divider.style.margin = '8px 0 12px';
    this.node.appendChild(divider);

    const gaHeading = document.createElement('div');
    gaHeading.textContent = 'General access';
    gaHeading.style.fontWeight = '600';
    gaHeading.style.marginBottom = '6px';
    this.node.appendChild(gaHeading);

    const gaRow = document.createElement('div');
    gaRow.style.display = 'flex';
    gaRow.style.gap = '6px';
    gaRow.style.alignItems = 'center';
    gaRow.style.marginBottom = '6px';

    this.generalAccessSelect = document.createElement('select');
    const restrictedOpt = document.createElement('option');
    restrictedOpt.value = 'restricted';
    restrictedOpt.textContent = 'Restricted';
    const domainOpt = document.createElement('option');
    domainOpt.value = 'domain';
    domainOpt.textContent = ownerDomain
      ? `Anyone at ${ownerDomain}`
      : 'Anyone in your domain';
    this.generalAccessSelect.appendChild(restrictedOpt);
    this.generalAccessSelect.appendChild(domainOpt);
    this.generalAccessSelect.value = initialGeneralAccess;
    this.generalAccessSelect.addEventListener('change', () => this.updateLinkState());

    this.linkRoleSelect = this.buildRoleSelect(initialLinkAccess === 'write' ? 'editor' : 'viewer');

    gaRow.appendChild(this.generalAccessSelect);
    gaRow.appendChild(this.linkRoleSelect);
    this.node.appendChild(gaRow);

    this.linkHint = document.createElement('span');
    this.linkHint.style.fontSize = '12px';
    this.linkHint.style.color = '#666';
    this.linkHint.style.display = 'block';
    this.linkHint.style.marginBottom = '6px';
    this.node.appendChild(this.linkHint);

    this.copyLinkBtn = document.createElement('button');
    this.copyLinkBtn.textContent = 'Copy link';
    this.copyLinkBtn.style.cursor = 'pointer';
    this.copyLinkBtn.style.padding = '3px 10px';
    this.copyLinkBtn.addEventListener('click', e => {
      e.preventDefault();
      this.copyLink();
    });
    this.node.appendChild(this.copyLinkBtn);

    this.updateLinkState();
  }

  private buildRoleSelect(initial: Role): HTMLSelectElement {
    const select = document.createElement('select');
    for (const [value, label] of [
      ['viewer', 'Viewer'],
      ['editor', 'Editor']
    ] as const) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === initial) {
        opt.selected = true;
      }
      select.appendChild(opt);
    }
    return select;
  }

  private updateLinkState(): void {
    const domain = this.generalAccessSelect.value === 'domain';
    this.linkRoleSelect.disabled = !domain;
    this.copyLinkBtn.disabled = !domain || !this.shareLink;
    if (!this.shareLink) {
      this.linkHint.textContent =
        'Save the share first to get a copyable link for your domain.';
    } else if (domain) {
      this.linkHint.textContent = `Anyone at ${this.ownerDomain || 'your domain'} with the link can access “${this.folderName}”.`;
    } else {
      this.linkHint.textContent = 'Only people explicitly added above can access this folder.';
    }
  }

  private commitCurrentInput(): void {
    const email = this.emailInput.value.trim().replace(/,$/, '');
    if (!email) {
      return;
    }
    if (!EMAIL_RE.test(email)) {
      this.showError(`“${email}” is not a valid email.`);
      return;
    }
    if (this.rows.some(r => r.email.toLowerCase() === email.toLowerCase())) {
      this.showError(`${email} is already in the list.`);
      return;
    }
    this.hideError();
    this.addRow(email, this.roleSelect.value as Role);
    this.emailInput.value = '';
    this.emailInput.focus();
  }

  private addRow(email: string, role: Role): void {
    const row: RecipientRow = {
      container: document.createElement('div'),
      email,
      role
    };
    row.container.style.display = 'flex';
    row.container.style.alignItems = 'center';
    row.container.style.gap = '8px';
    row.container.style.padding = '3px 6px';
    row.container.style.background = '#f5f5f5';
    row.container.style.borderRadius = '4px';

    const emailSpan = document.createElement('span');
    emailSpan.textContent = email;
    emailSpan.style.flex = '1';
    emailSpan.style.overflow = 'hidden';
    emailSpan.style.textOverflow = 'ellipsis';

    const rowRoleSelect = this.buildRoleSelect(role);
    rowRoleSelect.addEventListener('change', () => {
      row.role = rowRoleSelect.value as Role;
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.style.cursor = 'pointer';
    removeBtn.style.border = 'none';
    removeBtn.style.background = 'transparent';
    removeBtn.style.fontSize = '16px';
    removeBtn.addEventListener('click', e => {
      e.preventDefault();
      this.rows = this.rows.filter(r => r !== row);
      row.container.remove();
    });

    row.container.appendChild(emailSpan);
    row.container.appendChild(rowRoleSelect);
    row.container.appendChild(removeBtn);

    this.chipsContainer.appendChild(row.container);
    this.rows.push(row);
  }

  private async copyLink(): Promise<void> {
    if (!this.shareLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(this.shareLink);
      const original = this.copyLinkBtn.textContent;
      this.copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => {
        this.copyLinkBtn.textContent = original;
      }, 1500);
    } catch {
      this.showError('Copy failed — select and copy the link manually.');
    }
  }

  private showError(msg: string): void {
    this.errorSpan.textContent = msg;
    this.errorSpan.style.display = 'block';
  }

  private hideError(): void {
    this.errorSpan.style.display = 'none';
  }

  validate(): boolean {
    // Before validating, try to flush anything still in the email input.
    if (this.emailInput.value.trim()) {
      this.commitCurrentInput();
      if (this.errorSpan.style.display === 'block') {
        return false;
      }
    }
    const generalAccess = this.generalAccessSelect.value as GeneralAccess;
    if (this.rows.length === 0 && generalAccess === 'restricted') {
      this.showError('Add at least one person or enable domain-wide access.');
      return false;
    }
    this.hideError();
    return true;
  }

  getValue(): ShareDialogResult {
    const generalAccess = this.generalAccessSelect.value as GeneralAccess;
    const linkRole = this.linkRoleSelect.value as Role;
    return {
      recipients: this.rows.map(r => ({ email: r.email, role: r.role })),
      generalAccess,
      linkAccessLevel: linkRole === 'editor' ? 'write' : 'read'
    };
  }
}
