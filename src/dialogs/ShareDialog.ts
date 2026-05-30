import { Widget } from '@lumino/widgets';
import { AccessLevel, GeneralAccess, Permission, Role } from '../api';

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface ShareController {
  /** Add or update a recipient's role. Returns up-to-date share link (may be null until first action). */
  upsertRecipient(email: string, role: Role): Promise<string | null>;
  /** Remove a recipient. */
  revokeRecipient(email: string): Promise<void>;
  /** Change general access + link role. Returns up-to-date share link (may be null until first action). */
  setGeneralAccess(mode: GeneralAccess, level: AccessLevel): Promise<string | null>;
  /** Current share link, if one exists. */
  currentShareLink(): string | null;
}

interface RecipientRow {
  container: HTMLDivElement;
  email: string;
  role: Role;
  roleSelect: HTMLSelectElement;
  removeBtn: HTMLButtonElement;
}

export class ShareDialogBody extends Widget {
  private emailInput: HTMLInputElement;
  private addRoleSelect: HTMLSelectElement;
  private addBtn: HTMLButtonElement;
  private chipsContainer: HTMLDivElement;
  private peopleHeading: HTMLDivElement;
  private errorSpan: HTMLSpanElement;
  private statusSpan: HTMLSpanElement;
  private generalAccessSelect: HTMLSelectElement;
  private linkRoleSelect: HTMLSelectElement;
  private linkHint: HTMLSpanElement;
  private copyLinkBtn: HTMLButtonElement;
  private rows: RecipientRow[] = [];

  constructor(
    private readonly folderName: string,
    private readonly ownerDomain: string,
    initialGeneralAccess: GeneralAccess = 'restricted',
    initialLinkAccess: AccessLevel = 'read',
    existingPermissions: Permission[] = [],
    private readonly ownerEmail = '',
    private readonly controller?: ShareController
  ) {
    super({ node: document.createElement('div') });
    this.node.style.minWidth = '500px';
    this.node.style.fontSize = '13px';

    this.peopleHeading = document.createElement('div');
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
    for (const p of existingPermissions) {
      if (p.user_email === ownerEmail) {
        continue;
      }
      this.addRow(
        p.user_email,
        p.access_level === 'write' ? 'editor' : 'viewer'
      );
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
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        void this.commitCurrentInput();
      }
    });

    this.addRoleSelect = buildRoleSelect('viewer');

    this.addBtn = document.createElement('button');
    this.addBtn.textContent = 'Add';
    this.addBtn.style.cursor = 'pointer';
    this.addBtn.addEventListener('click', e => {
      e.preventDefault();
      void this.commitCurrentInput();
    });

    addRow.appendChild(this.emailInput);
    addRow.appendChild(this.addRoleSelect);
    addRow.appendChild(this.addBtn);
    this.node.appendChild(addRow);

    this.errorSpan = document.createElement('span');
    this.errorSpan.style.color = '#e74c3c';
    this.errorSpan.style.fontSize = '12px';
    this.errorSpan.style.display = 'none';
    this.errorSpan.style.marginBottom = '8px';
    this.node.appendChild(this.errorSpan);

    this.statusSpan = document.createElement('span');
    this.statusSpan.style.color = '#888';
    this.statusSpan.style.fontSize = '12px';
    this.statusSpan.style.display = 'none';
    this.statusSpan.style.marginBottom = '8px';
    this.node.appendChild(this.statusSpan);

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
    addOption(this.generalAccessSelect, 'restricted', 'Restricted');
    addOption(
      this.generalAccessSelect,
      'domain',
      ownerDomain ? `Anyone at ${ownerDomain}` : 'Anyone in your domain'
    );
    this.generalAccessSelect.value = initialGeneralAccess;
    this.generalAccessSelect.addEventListener('change', () => {
      void this.commitGeneralAccess();
    });

    this.linkRoleSelect = buildRoleSelect(
      initialLinkAccess === 'write' ? 'editor' : 'viewer'
    );
    this.linkRoleSelect.addEventListener('change', () => {
      void this.commitGeneralAccess();
    });

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

  private setBusy(msg: string | null): void {
    if (msg === null) {
      this.statusSpan.style.display = 'none';
      return;
    }
    this.statusSpan.textContent = msg;
    this.statusSpan.style.display = 'block';
  }

  private updateLinkState(): void {
    const domain = this.generalAccessSelect.value === 'domain';
    this.linkRoleSelect.disabled = !domain;
    const link = this.controller?.currentShareLink() ?? null;
    this.copyLinkBtn.disabled = !link;
    if (!link) {
      this.linkHint.textContent =
        'Link becomes available once the folder has been shared with at least one recipient or domain access is enabled.';
    } else if (domain) {
      this.linkHint.textContent = `Anyone at ${
        this.ownerDomain || 'your domain'
      } with this link can access “${this.folderName}”.`;
    } else {
      this.linkHint.textContent =
        'Only people explicitly added above can use this link.';
    }
  }

  private async commitCurrentInput(): Promise<void> {
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
    const role = this.addRoleSelect.value as Role;
    this.hideError();
    if (!this.controller) {
      return;
    }

    // Optimistic: render immediately. Revert on failure.
    const row = this.addRow(email, role);
    this.emailInput.value = '';
    this.emailInput.focus();
    this.updatePeopleHeading();
    this.setBusy(`Sharing with ${email}…`);
    try {
      await this.controller.upsertRecipient(email, role);
      this.setBusy(null);
      this.updateLinkState();
    } catch (err) {
      this.removeRowNode(row);
      this.updatePeopleHeading();
      this.setBusy(null);
      this.showError(
        err instanceof Error ? err.message : 'Failed to share with this user.'
      );
    }
  }

  private addRow(email: string, role: Role): RecipientRow {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.gap = '8px';
    container.style.padding = '3px 6px';
    container.style.background = '#eef5ff';
    container.style.borderRadius = '4px';

    const emailSpan = document.createElement('span');
    emailSpan.textContent = email;
    emailSpan.style.flex = '1';
    emailSpan.style.overflow = 'hidden';
    emailSpan.style.textOverflow = 'ellipsis';

    const roleSelect = buildRoleSelect(role);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.style.cursor = 'pointer';
    removeBtn.style.border = 'none';
    removeBtn.style.background = 'transparent';
    removeBtn.style.fontSize = '16px';

    container.appendChild(emailSpan);
    container.appendChild(roleSelect);
    container.appendChild(removeBtn);
    this.chipsContainer.appendChild(container);

    const row: RecipientRow = { container, email, role, roleSelect, removeBtn };
    this.rows.push(row);

    roleSelect.addEventListener('change', async () => {
      const prev = row.role;
      const next = roleSelect.value as Role;
      if (prev === next || !this.controller) {
        return;
      }
      this.setBusy(`Updating ${email}…`);
      try {
        await this.controller.upsertRecipient(email, next);
        row.role = next;
        this.setBusy(null);
      } catch (err) {
        roleSelect.value = prev;
        this.setBusy(null);
        this.showError(
          err instanceof Error
            ? err.message
            : `Failed to update ${email}'s access.`
        );
      }
    });

    removeBtn.addEventListener('click', async () => {
      if (!this.controller) {
        this.removeRowNode(row);
        this.updatePeopleHeading();
        return;
      }
      const prev = removeBtn.textContent;
      removeBtn.textContent = '…';
      removeBtn.disabled = true;
      roleSelect.disabled = true;
      this.setBusy(`Removing ${email}…`);
      try {
        await this.controller.revokeRecipient(email);
        this.removeRowNode(row);
        this.updatePeopleHeading();
        this.setBusy(null);
      } catch (err) {
        removeBtn.textContent = prev;
        removeBtn.disabled = false;
        roleSelect.disabled = false;
        this.setBusy(null);
        this.showError(
          err instanceof Error ? err.message : `Failed to remove ${email}.`
        );
      }
    });

    return row;
  }

  private removeRowNode(row: RecipientRow): void {
    this.rows = this.rows.filter(r => r !== row);
    row.container.remove();
  }

  private async commitGeneralAccess(): Promise<void> {
    if (!this.controller) {
      return;
    }
    const mode = this.generalAccessSelect.value as GeneralAccess;
    const linkRole = this.linkRoleSelect.value as Role;
    const level: AccessLevel = linkRole === 'editor' ? 'write' : 'read';

    this.setBusy('Updating general access…');
    try {
      await this.controller.setGeneralAccess(mode, level);
      this.setBusy(null);
      this.updateLinkState();
    } catch (err) {
      this.setBusy(null);
      this.showError(
        err instanceof Error
          ? err.message
          : 'Failed to update general access.'
      );
    }
  }

  private async copyLink(): Promise<void> {
    const link = this.controller?.currentShareLink() ?? null;
    if (!link) {
      return;
    }
    const ok = await tryCopyToClipboard(link);
    if (ok) {
      const original = this.copyLinkBtn.textContent;
      this.copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => {
        this.copyLinkBtn.textContent = original;
      }, 1500);
    } else {
      this.showError(
        `Copy failed. The link is: ${link} — select and copy it manually.`
      );
    }
  }

  private showError(msg: string): void {
    this.errorSpan.textContent = msg;
    this.errorSpan.style.display = 'block';
    setTimeout(() => this.hideError(), 5000);
  }

  private hideError(): void {
    this.errorSpan.style.display = 'none';
  }

  /**
   * Re-render the link button/hint — used after the controller mutates its
   * internal state (e.g. first shareFolder call populates the share link).
   */
  refreshLinkState(): void {
    this.updateLinkState();
  }
}

function buildRoleSelect(initial: Role): HTMLSelectElement {
  const select = document.createElement('select');
  addOption(select, 'viewer', 'Viewer');
  addOption(select, 'editor', 'Editor');
  select.value = initial;
  return select;
}

function addOption(select: HTMLSelectElement, value: string, label: string): void {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = label;
  select.appendChild(opt);
}

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
