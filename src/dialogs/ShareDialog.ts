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
  /**
   * Ensure a share link exists, creating the underlying volume on demand even
   * if nobody has been added yet. Returns the link.
   */
  ensureShareLink(): Promise<string | null>;
}

interface RecipientRow {
  container: HTMLDivElement;
  email: string;
  role: Role;
  roleSelect: HTMLSelectElement;
  removeBtn: HTMLButtonElement;
}

function initials(email: string): string {
  const local = email.split('@')[0] || email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
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
  private gaIcon: HTMLDivElement;
  private linkHint: HTMLSpanElement;
  private linkBox: HTMLInputElement;
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
    this.addClass('jp-ShareDialog');

    // --- People with access ---
    this.peopleHeading = document.createElement('div');
    this.peopleHeading.className = 'jp-ShareDialog-section';
    this.node.appendChild(this.peopleHeading);

    this.chipsContainer = document.createElement('div');
    this.chipsContainer.className = 'jp-ShareDialog-people';
    this.node.appendChild(this.chipsContainer);

    if (ownerEmail) {
      this.renderOwnerChip(ownerEmail);
    }
    for (const p of existingPermissions) {
      if (p.user_email === ownerEmail) {
        continue;
      }
      this.addRow(p.user_email, p.access_level === 'write' ? 'editor' : 'viewer');
    }
    this.updatePeopleHeading();

    // --- Add people ---
    const addHeading = document.createElement('div');
    addHeading.textContent = 'Add people';
    addHeading.className = 'jp-ShareDialog-section';
    this.node.appendChild(addHeading);

    const addRow = document.createElement('div');
    addRow.className = 'jp-ShareDialog-addrow';

    this.emailInput = document.createElement('input');
    this.emailInput.type = 'email';
    this.emailInput.placeholder = 'Add people by email';
    this.emailInput.className = 'jp-mod-styled';
    this.emailInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        void this.commitCurrentInput();
      }
    });

    this.addRoleSelect = buildRoleSelect('viewer');

    this.addBtn = document.createElement('button');
    this.addBtn.textContent = 'Add';
    this.addBtn.className = 'jp-ShareDialog-btn';
    this.addBtn.addEventListener('click', e => {
      e.preventDefault();
      void this.commitCurrentInput();
    });

    addRow.appendChild(this.emailInput);
    addRow.appendChild(this.addRoleSelect);
    addRow.appendChild(this.addBtn);
    this.node.appendChild(addRow);

    this.errorSpan = document.createElement('span');
    this.errorSpan.className = 'jp-ShareDialog-error';
    this.node.appendChild(this.errorSpan);

    this.statusSpan = document.createElement('span');
    this.statusSpan.className = 'jp-ShareDialog-status';
    this.node.appendChild(this.statusSpan);

    const divider = document.createElement('hr');
    divider.className = 'jp-ShareDialog-divider';
    this.node.appendChild(divider);

    // --- General access ---
    const gaHeading = document.createElement('div');
    gaHeading.textContent = 'General access';
    gaHeading.className = 'jp-ShareDialog-section';
    this.node.appendChild(gaHeading);

    const gaRow = document.createElement('div');
    gaRow.className = 'jp-ShareDialog-ga';

    this.gaIcon = document.createElement('div');
    this.gaIcon.className = 'jp-ShareDialog-ga-icon';

    this.generalAccessSelect = document.createElement('select');
    this.generalAccessSelect.className = 'jp-mod-styled jp-ShareDialog-ga-select';
    addOption(this.generalAccessSelect, 'restricted', 'Restricted');
    addOption(this.generalAccessSelect, 'link', 'Anyone with the link');
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

    gaRow.appendChild(this.gaIcon);
    gaRow.appendChild(this.generalAccessSelect);
    gaRow.appendChild(this.linkRoleSelect);
    this.node.appendChild(gaRow);

    this.linkHint = document.createElement('span');
    this.linkHint.className = 'jp-ShareDialog-hint';
    this.node.appendChild(this.linkHint);

    // --- Share link row (always available; created on demand) ---
    const linkRow = document.createElement('div');
    linkRow.className = 'jp-ShareDialog-linkrow';

    this.linkBox = document.createElement('input');
    this.linkBox.type = 'text';
    this.linkBox.readOnly = true;
    this.linkBox.className = 'jp-ShareDialog-linkbox';
    this.linkBox.addEventListener('focus', () => this.linkBox.select());

    this.copyLinkBtn = document.createElement('button');
    this.copyLinkBtn.textContent = 'Copy link';
    this.copyLinkBtn.className = 'jp-ShareDialog-btn secondary';
    this.copyLinkBtn.addEventListener('click', e => {
      e.preventDefault();
      void this.copyLink();
    });

    linkRow.appendChild(this.linkBox);
    linkRow.appendChild(this.copyLinkBtn);
    this.node.appendChild(linkRow);

    this.updateLinkState();
  }

  private renderOwnerChip(email: string): void {
    const row = document.createElement('div');
    row.className = 'jp-ShareDialog-row is-owner';

    const avatar = document.createElement('div');
    avatar.className = 'jp-ShareDialog-avatar is-owner';
    avatar.textContent = initials(email);

    const meta = document.createElement('div');
    meta.className = 'jp-ShareDialog-meta';
    const emailEl = document.createElement('div');
    emailEl.className = 'jp-ShareDialog-email';
    emailEl.textContent = email;
    const tag = document.createElement('div');
    tag.className = 'jp-ShareDialog-tag';
    tag.textContent = 'Owner';
    meta.appendChild(emailEl);
    meta.appendChild(tag);

    row.appendChild(avatar);
    row.appendChild(meta);
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
    const mode = this.generalAccessSelect.value as GeneralAccess;
    const linkBased = mode !== 'restricted';
    this.linkRoleSelect.disabled = !linkBased;

    const icons: Record<GeneralAccess, string> = {
      restricted: '🔒',
      link: '🔗',
      domain: '🏛️'
    };
    this.gaIcon.textContent = icons[mode] ?? '🔒';

    const link = this.controller?.currentShareLink() ?? null;
    this.linkBox.value = link ?? '';
    this.linkBox.placeholder =
      'A link will be generated when you click “Copy link”.';
    // Always allow generating/copying a link — no need to pre-share.
    this.copyLinkBtn.disabled = false;

    if (mode === 'domain') {
      this.linkHint.textContent = `Anyone at ${
        this.ownerDomain || 'your domain'
      } with this link can open “${this.folderName}” as ${
        this.linkRoleSelect.value === 'editor' ? 'an editor' : 'a viewer'
      }.`;
    } else if (mode === 'link') {
      this.linkHint.textContent = `Anyone with this link can open “${
        this.folderName
      }” as ${
        this.linkRoleSelect.value === 'editor' ? 'an editor' : 'a viewer'
      }. No need to add them individually.`;
    } else {
      this.linkHint.textContent =
        'Restricted — only people you add above can open the folder. ' +
        'Switch to “Anyone with the link” to share without adding people.';
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
    container.className = 'jp-ShareDialog-row';

    const avatar = document.createElement('div');
    avatar.className = 'jp-ShareDialog-avatar';
    avatar.textContent = initials(email);

    const meta = document.createElement('div');
    meta.className = 'jp-ShareDialog-meta';
    const emailEl = document.createElement('div');
    emailEl.className = 'jp-ShareDialog-email';
    emailEl.textContent = email;
    meta.appendChild(emailEl);

    const roleSelect = buildRoleSelect(role);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.className = 'jp-ShareDialog-remove';

    container.appendChild(avatar);
    container.appendChild(meta);
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
    if (!this.controller) {
      return;
    }
    this.copyLinkBtn.disabled = true;
    const original = this.copyLinkBtn.textContent;
    this.copyLinkBtn.textContent = 'Working…';
    let link: string | null = null;
    try {
      // Create the volume on demand if it doesn't exist yet — the user does
      // NOT have to share with anyone first.
      link = await this.controller.ensureShareLink();
    } catch (err) {
      this.copyLinkBtn.textContent = original;
      this.copyLinkBtn.disabled = false;
      this.showError(
        err instanceof Error ? err.message : 'Could not generate the link.'
      );
      return;
    }
    this.updateLinkState();
    this.copyLinkBtn.disabled = false;
    if (!link) {
      this.copyLinkBtn.textContent = original;
      return;
    }
    const ok = await tryCopyToClipboard(link);
    if (ok) {
      this.copyLinkBtn.textContent = 'Copied!';
      setTimeout(() => {
        this.copyLinkBtn.textContent = original;
      }, 1500);
    } else {
      this.copyLinkBtn.textContent = original;
      this.showError(
        `Copy failed. The link is in the box — select and copy it manually.`
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
  // jp-mod-styled makes the dropdown match JupyterLab's native form controls.
  select.className = 'jp-mod-styled jp-ShareDialog-role';
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
