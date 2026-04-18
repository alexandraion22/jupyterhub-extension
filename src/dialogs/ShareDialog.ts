import { Widget } from '@lumino/widgets';
import {
  AccessLevel,
  GeneralAccess,
  Permission,
  Recipient,
  Role
} from '../api';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface ShareDialogResult {
  recipients: Recipient[];
  removed: string[];
  generalAccess: GeneralAccess;
  linkAccessLevel: AccessLevel;
}

interface ExistingRecipient {
  email: string;
  originalRole: Role;
}

interface RecipientRow {
  container: HTMLDivElement;
  email: string;
  role: Role;
  isExisting: boolean;
}

export class ShareDialogBody extends Widget {
  private emailInput: HTMLInputElement;
  private roleSelect: HTMLSelectElement;
  private chipsContainer: HTMLDivElement;
  private peopleHeading: HTMLDivElement;
  private errorSpan: HTMLSpanElement;
  private generalAccessSelect: HTMLSelectElement;
  private linkRoleSelect: HTMLSelectElement;
  private linkHint: HTMLSpanElement;
  private copyLinkBtn: HTMLButtonElement;
  private rows: RecipientRow[] = [];
  private readonly ownerEmail: string;
  private readonly existing: ExistingRecipient[];

  constructor(
    private readonly folderName: string,
    private readonly ownerDomain: string,
    private readonly shareLink: string | null,
    initialGeneralAccess: GeneralAccess = 'restricted',
    initialLinkAccess: AccessLevel = 'read',
    existingPermissions: Permission[] = [],
    ownerEmail = ''
  ) {
    super({ node: document.createElement('div') });
    this.node.style.minWidth = '480px';
    this.node.style.fontSize = '13px';

    this.ownerEmail = ownerEmail;
    this.existing = existingPermissions
      .filter(p => p.user_email !== ownerEmail)
      .map(p => ({
        email: p.user_email,
        originalRole: p.access_level === 'write' ? 'editor' : 'viewer'
      }));

    this.peopleHeading = document.createElement('div');
    this.peopleHeading.textContent = 'People with access';
    this.peopleHeading.style.fontWeight = '600';
    this.peopleHeading.style.marginBottom = '6px';
    this.node.appendChild(this.peopleHeading);

    this.chipsContainer = document.createElement('div');
    this.chipsContainer.style.display = 'flex';
    this.chipsContainer.style.flexDirection = 'column';
    this.chipsContainer.style.gap = '4px';
    this.chipsContainer.style.marginBottom = '10px';
    this.chipsContainer.style.maxHeight = '180px';
    this.chipsContainer.style.overflowY = 'auto';
    this.node.appendChild(this.chipsContainer);

    if (ownerEmail) {
      this.renderOwnerChip(ownerEmail);
    }
    for (const e of this.existing) {
      this.addRow(e.email, e.originalRole, /*isExisting*/ true);
    }
    this.updatePeopleHeading();

    const addHeading = document.createElement('div');
    addHeading.textContent = 'Add people';
    addHeading.style.fontWeight = '600';
    addHeading.style.margin = '10px 0 6px';
    this.node.appendChild(addHeading);

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
    this.generalAccessSelect.addEventListener('change', () =>
      this.updateLinkState()
    );

    this.linkRoleSelect = this.buildRoleSelect(
      initialLinkAccess === 'write' ? 'editor' : 'viewer'
    );

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
      void this.copyLink();
    });
    this.node.appendChild(this.copyLinkBtn);

    this.updateLinkState();
  }

  private renderOwnerChip(email: string): void {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.gap = '8px';
    row.style.padding = '3px 6px';
    row.style.background = '#f5f5f5';
    row.style.borderRadius = '4px';

    const emailSpan = document.createElement('span');
    emailSpan.textContent = `${email} (owner)`;
    emailSpan.style.flex = '1';
    emailSpan.style.color = '#666';
    emailSpan.style.fontStyle = 'italic';

    row.appendChild(emailSpan);
    this.chipsContainer.appendChild(row);
  }

  private updatePeopleHeading(): void {
    const activeCount = this.rows.length + 1; // +1 for owner
    this.peopleHeading.textContent = `People with access (${activeCount})`;
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
    // Button is usable whenever there's a link; domain toggle doesn't
    // prevent copying (if we have a link, they can share it).
    this.copyLinkBtn.disabled = !this.shareLink;
    if (!this.shareLink) {
      this.linkHint.textContent =
        'Save the share first, then come back to copy the link.';
    } else if (domain) {
      this.linkHint.textContent = `Anyone at ${
        this.ownerDomain || 'your domain'
      } with the link can access “${this.folderName}”.`;
    } else {
      this.linkHint.textContent =
        'Link below grants access only to explicitly-added people.';
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
    if (email.toLowerCase() === this.ownerEmail.toLowerCase()) {
      this.showError('You already own this folder.');
      return;
    }
    if (this.rows.some(r => r.email.toLowerCase() === email.toLowerCase())) {
      this.showError(`${email} is already in the list.`);
      return;
    }
    this.hideError();
    this.addRow(email, this.roleSelect.value as Role, /*isExisting*/ false);
    this.emailInput.value = '';
    this.emailInput.focus();
    this.updatePeopleHeading();
  }

  private addRow(email: string, role: Role, isExisting: boolean): void {
    const row: RecipientRow = {
      container: document.createElement('div'),
      email,
      role,
      isExisting
    };
    row.container.style.display = 'flex';
    row.container.style.alignItems = 'center';
    row.container.style.gap = '8px';
    row.container.style.padding = '3px 6px';
    row.container.style.background = isExisting ? '#eef5ff' : '#f5f5f5';
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
      this.updatePeopleHeading();
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
    const ok = await tryCopyToClipboard(this.shareLink);
    if (ok) {
      const original = this.copyLinkBtn.textContent;
      this.copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => {
        this.copyLinkBtn.textContent = original;
      }, 1500);
    } else {
      this.showError(
        `Copy failed. The link is: ${this.shareLink} — select and copy it manually.`
      );
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
    if (this.emailInput.value.trim()) {
      this.commitCurrentInput();
      if (this.errorSpan.style.display === 'block') {
        return false;
      }
    }
    this.hideError();
    return true;
  }

  getValue(): ShareDialogResult {
    const generalAccess = this.generalAccessSelect.value as GeneralAccess;
    const linkRole = this.linkRoleSelect.value as Role;

    const finalEmails = new Set(this.rows.map(r => r.email.toLowerCase()));
    const removed = this.existing
      .map(e => e.email)
      .filter(email => !finalEmails.has(email.toLowerCase()));

    // Only re-send recipients that are new or whose role changed.
    const recipients: Recipient[] = this.rows
      .filter(r => {
        if (!r.isExisting) {
          return true;
        }
        const orig = this.existing.find(
          e => e.email.toLowerCase() === r.email.toLowerCase()
        );
        return orig?.originalRole !== r.role;
      })
      .map(r => ({ email: r.email, role: r.role }));

    return {
      recipients,
      removed,
      generalAccess,
      linkAccessLevel: linkRole === 'editor' ? 'write' : 'read'
    };
  }
}

/**
 * Try navigator.clipboard (requires secure context / HTTPS), fall back to a
 * hidden-textarea + document.execCommand('copy') which works from any
 * user-initiated event in every browser we care about.
 */
async function tryCopyToClipboard(text: string): Promise<boolean> {
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
