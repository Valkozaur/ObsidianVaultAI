import { ItemView, WorkspaceLeaf } from 'obsidian';
import type VaultAIPlugin from '../main';
import { ContextScope } from '../types';
import { ChatTab } from './ChatTab';

export const VIEW_TYPE_VAULT_AI = 'vault-ai-view';

export class VaultAIView extends ItemView {
  plugin: VaultAIPlugin;
  private contentEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private chatTab: ChatTab | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: VaultAIPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_VAULT_AI;
  }

  getDisplayText(): string {
    return 'Vault AI';
  }

  getIcon(): string {
    return 'brain';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('vault-ai-container');

    // Header with connection status
    const header = container.createDiv('vault-ai-header');
    header.createEl('h4', { text: 'Vault AI' });
    this.statusEl = header.createSpan('vault-ai-status');
    this.updateConnectionStatus();

    // Content area
    this.contentEl = container.createDiv('vault-ai-tab-content');

    // Initialize and render chat
    this.chatTab = new ChatTab(this.plugin, this);
    this.chatTab.render(this.contentEl);
  }

  async onClose(): Promise<void> {
    // Cleanup
  }

  updateConnectionStatus(): void {
    if (!this.statusEl) return;

    const status = this.plugin.connectionStatus;
    this.statusEl.empty();

    const statusConfig = {
      ready: { text: 'Ready', cls: 'ready' },
      thinking: { text: 'Thinking...', cls: 'thinking' },
      offline: { text: 'Offline', cls: 'offline' },
    };

    const config = statusConfig[status];
    this.statusEl.setText(config.text);
    this.statusEl.className = `vault-ai-status ${config.cls}`;
  }

  setConnectionStatus(status: 'ready' | 'thinking' | 'offline'): void {
    this.plugin.setConnectionStatus(status);
  }

  setContextScope(scope: ContextScope): void {
    this.chatTab?.setScope(scope);
  }

  getCurrentFile(): string | null {
    const activeFile = this.app.workspace.getActiveFile();
    return activeFile?.path || null;
  }
}
