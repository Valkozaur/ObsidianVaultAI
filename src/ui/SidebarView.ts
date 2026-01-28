import { ItemView, WorkspaceLeaf } from 'obsidian';
import type VaultAIPlugin from '../main';
import { TabType, ContextScope } from '../types';
import { ChatTab } from './ChatTab';
import { FormatTab } from './FormatTab';
import { StructureTab } from './StructureTab';

export const VIEW_TYPE_VAULT_AI = 'vault-ai-view';

export class VaultAIView extends ItemView {
  plugin: VaultAIPlugin;
  private activeTab: TabType = 'chat';
  private tabContentEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private tabButtons: Map<TabType, HTMLElement> = new Map();

  private chatTab: ChatTab | null = null;
  private formatTab: FormatTab | null = null;
  private structureTab: StructureTab | null = null;

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

    // Tab bar
    const tabBar = container.createDiv('vault-ai-tab-bar');
    this.createTabButton(tabBar, 'chat', 'Chat');
    this.createTabButton(tabBar, 'format', 'Format');
    this.createTabButton(tabBar, 'structure', 'Structure');

    // Tab content area
    this.tabContentEl = container.createDiv('vault-ai-tab-content');

    // Initialize tabs
    this.chatTab = new ChatTab(this.plugin, this);
    this.formatTab = new FormatTab(this.plugin, this);
    this.structureTab = new StructureTab(this.plugin, this);

    // Render initial tab
    this.renderActiveTab();
  }

  async onClose(): Promise<void> {
    // Cleanup
  }

  private createTabButton(parent: HTMLElement, tab: TabType, label: string): void {
    const button = parent.createEl('button', {
      text: label,
      cls: `vault-ai-tab-button ${this.activeTab === tab ? 'active' : ''}`,
    });

    button.addEventListener('click', () => {
      this.switchTab(tab);
    });

    this.tabButtons.set(tab, button);
  }

  switchTab(tab: TabType): void {
    if (this.activeTab === tab) return;

    // Update button states
    this.tabButtons.get(this.activeTab)?.removeClass('active');
    this.tabButtons.get(tab)?.addClass('active');

    this.activeTab = tab;
    this.renderActiveTab();
  }

  private renderActiveTab(): void {
    if (!this.tabContentEl) return;

    this.tabContentEl.empty();

    switch (this.activeTab) {
      case 'chat':
        this.chatTab?.render(this.tabContentEl);
        break;
      case 'format':
        this.formatTab?.render(this.tabContentEl);
        break;
      case 'structure':
        this.structureTab?.render(this.tabContentEl);
        break;
    }
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
