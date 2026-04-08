import { Widget } from '@lumino/widgets';
import { Permission } from '../api';

export class PermissionsDialogBody extends Widget {
  private tableBody: HTMLTableSectionElement;
  private statusDiv: HTMLDivElement;
  private _onRevoke: ((email: string) => Promise<void>) | null = null;

  constructor() {
    super({ node: document.createElement('div') });
    this.node.style.minWidth = '400px';

    this.statusDiv = document.createElement('div');
    this.statusDiv.textContent = 'Loading permissions...';
    this.statusDiv.style.padding = '10px 0';
    this.node.appendChild(this.statusDiv);

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    table.style.display = 'none';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const text of ['Email', 'Access', 'Actions']) {
      const th = document.createElement('th');
      th.textContent = text;
      th.style.textAlign = 'left';
      th.style.padding = '6px 8px';
      th.style.borderBottom = '2px solid #ddd';
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    this.tableBody = document.createElement('tbody');
    table.appendChild(this.tableBody);
    this.node.appendChild(table);
  }

  set onRevoke(handler: (email: string) => Promise<void>) {
    this._onRevoke = handler;
  }

  setPermissions(permissions: Permission[], ownerEmail: string): void {
    this.statusDiv.style.display = 'none';
    const table = this.node.querySelector('table') as HTMLTableElement;
    table.style.display = 'table';

    this.tableBody.innerHTML = '';

    if (permissions.length === 0) {
      this.statusDiv.textContent = 'No permissions found.';
      this.statusDiv.style.display = 'block';
      table.style.display = 'none';
      return;
    }

    for (const perm of permissions) {
      const row = document.createElement('tr');
      const isOwner = perm.user_email === ownerEmail;

      const emailCell = document.createElement('td');
      emailCell.textContent = perm.user_email + (isOwner ? ' (owner)' : '');
      emailCell.style.padding = '6px 8px';
      emailCell.style.borderBottom = '1px solid #eee';

      const accessCell = document.createElement('td');
      accessCell.textContent = perm.access_level;
      accessCell.style.padding = '6px 8px';
      accessCell.style.borderBottom = '1px solid #eee';

      const actionCell = document.createElement('td');
      actionCell.style.padding = '6px 8px';
      actionCell.style.borderBottom = '1px solid #eee';

      if (!isOwner) {
        const revokeBtn = document.createElement('button');
        revokeBtn.textContent = 'Revoke';
        revokeBtn.style.cursor = 'pointer';
        revokeBtn.style.padding = '2px 8px';
        revokeBtn.addEventListener('click', async () => {
          if (this._onRevoke) {
            revokeBtn.textContent = 'Revoking...';
            revokeBtn.disabled = true;
            try {
              await this._onRevoke(perm.user_email);
              row.remove();
            } catch (err) {
              revokeBtn.textContent = 'Failed';
              setTimeout(() => {
                revokeBtn.textContent = 'Revoke';
                revokeBtn.disabled = false;
              }, 2000);
            }
          }
        });
        actionCell.appendChild(revokeBtn);
      }

      row.appendChild(emailCell);
      row.appendChild(accessCell);
      row.appendChild(actionCell);
      this.tableBody.appendChild(row);
    }
  }

  setError(message: string): void {
    this.statusDiv.textContent = message;
    this.statusDiv.style.display = 'block';
    this.statusDiv.style.color = '#e74c3c';
    const table = this.node.querySelector('table') as HTMLTableElement;
    table.style.display = 'none';
  }
}
