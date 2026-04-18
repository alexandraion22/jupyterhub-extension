import { Widget } from '@lumino/widgets';
import { Signal, ISignal } from '@lumino/signaling';
import { ShareSummary } from '../api';

export interface ShareOpenRequest {
  share: ShareSummary;
}

export class SharedWithMePanel extends Widget {
  private listEl: HTMLUListElement;
  private statusEl: HTMLDivElement;
  private refreshBtn: HTMLButtonElement;
  private _openRequested = new Signal<this, ShareOpenRequest>(this);
  private _refreshRequested = new Signal<this, void>(this);

  constructor() {
    super({ node: document.createElement('div') });
    this.id = 'jlab-shared-with-me';
    this.title.caption = 'Shared with me';
    this.title.iconClass = 'jp-SideBar-tabIcon';
    this.title.label = 'Shared';
    this.addClass('jp-SharedWithMePanel');

    this.node.style.padding = '8px';
    this.node.style.fontSize = '13px';
    this.node.style.overflowY = 'auto';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '8px';

    const title = document.createElement('strong');
    title.textContent = 'Shared with me';

    this.refreshBtn = document.createElement('button');
    this.refreshBtn.textContent = 'Refresh';
    this.refreshBtn.style.cursor = 'pointer';
    this.refreshBtn.addEventListener('click', () => this._refreshRequested.emit());

    header.appendChild(title);
    header.appendChild(this.refreshBtn);
    this.node.appendChild(header);

    this.statusEl = document.createElement('div');
    this.statusEl.style.color = '#888';
    this.statusEl.style.fontSize = '12px';
    this.statusEl.textContent = 'Loading…';
    this.node.appendChild(this.statusEl);

    this.listEl = document.createElement('ul');
    this.listEl.style.listStyle = 'none';
    this.listEl.style.padding = '0';
    this.listEl.style.margin = '0';
    this.node.appendChild(this.listEl);
  }

  get openRequested(): ISignal<this, ShareOpenRequest> {
    return this._openRequested;
  }

  get refreshRequested(): ISignal<this, void> {
    return this._refreshRequested;
  }

  setShares(shares: ShareSummary[]): void {
    this.listEl.innerHTML = '';
    const incoming = shares.filter(s => !s.is_owner);
    const owned = shares.filter(s => s.is_owner);

    if (incoming.length === 0 && owned.length === 0) {
      this.statusEl.textContent = 'No shared folders yet.';
      this.statusEl.style.display = 'block';
      return;
    }
    this.statusEl.style.display = 'none';

    if (incoming.length) {
      this.listEl.appendChild(this.renderSectionHeader('From others'));
      for (const s of incoming) {
        this.listEl.appendChild(this.renderItem(s));
      }
    }
    if (owned.length) {
      this.listEl.appendChild(this.renderSectionHeader('Shared by me'));
      for (const s of owned) {
        this.listEl.appendChild(this.renderItem(s));
      }
    }
  }

  setError(message: string): void {
    this.statusEl.textContent = message;
    this.statusEl.style.color = '#e74c3c';
    this.statusEl.style.display = 'block';
    this.listEl.innerHTML = '';
  }

  private renderSectionHeader(label: string): HTMLElement {
    const h = document.createElement('li');
    h.textContent = label;
    h.style.fontSize = '11px';
    h.style.textTransform = 'uppercase';
    h.style.letterSpacing = '0.04em';
    h.style.color = '#666';
    h.style.marginTop = '10px';
    h.style.marginBottom = '4px';
    return h;
  }

  private renderItem(share: ShareSummary): HTMLElement {
    const li = document.createElement('li');
    li.style.padding = '6px 4px';
    li.style.borderBottom = '1px solid #eee';
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => this._openRequested.emit({ share }));

    const name = document.createElement('div');
    name.textContent = share.display_name;
    name.style.fontWeight = '500';

    const sub = document.createElement('div');
    sub.style.fontSize = '11px';
    sub.style.color = '#666';
    const roleLabel = share.access_level === 'write' ? 'Editor' : 'Viewer';
    if (share.is_owner) {
      const shareState =
        share.general_access === 'domain'
          ? `shared · domain (${share.link_access_level === 'write' ? 'editor' : 'viewer'})`
          : 'private';
      sub.textContent = `You own · ${shareState}`;
    } else {
      const via = share.via === 'domain-link' ? 'via domain link' : 'shared directly';
      sub.textContent = `${roleLabel} · ${share.owner} · ${via}`;
    }

    li.appendChild(name);
    li.appendChild(sub);
    return li;
  }
}
