import { Plugin, WorkspaceLeaf } from 'obsidian';
import { VaultAISettings, DEFAULT_SETTINGS, ConnectionStatus } from './types';
import { VaultAISettingTab } from './settings';
import { LLMClient } from './llm/LLMClient';
import { OllamaClient } from './llm/OllamaClient';
import { LMStudioClient } from './llm/LMStudioClient';
import { VaultAIView, VIEW_TYPE_VAULT_AI } from './ui/SidebarView';
import { UndoStack } from './operations/UndoStack';

export default class VaultAIPlugin extends Plugin {
  settings: VaultAISettings = DEFAULT_SETTINGS;
  llmClient: LLMClient | null = null;
  undoStack: UndoStack = new UndoStack();
  connectionStatus: ConnectionStatus = 'offline';

  private statusBarItem: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize LLM client
    this.initializeLLMClient();

    // Register the sidebar view
    this.registerView(VIEW_TYPE_VAULT_AI, (leaf) => new VaultAIView(leaf, this));

    // Add ribbon icon
    this.addRibbonIcon('brain', 'Open Vault AI', () => {
      this.activateView();
    });

    // Add status bar item
    this.statusBarItem = this.addStatusBarItem();
    this.updateStatusBar();

    // Register commands
    this.addCommand({
      id: 'open-panel',
      name: 'Open panel',
      callback: () => {
        this.activateView();
      },
    });

    this.addCommand({
      id: 'ask-current',
      name: 'Ask about current note',
      callback: () => {
        this.activateView('chat', 'current');
      },
    });

    this.addCommand({
      id: 'format-current',
      name: 'Format current note',
      callback: () => {
        this.activateView('format');
      },
    });

    this.addCommand({
      id: 'analyze-structure',
      name: 'Analyze vault structure',
      callback: () => {
        this.activateView('structure');
      },
    });

    this.addCommand({
      id: 'undo',
      name: 'Undo last operation',
      callback: async () => {
        await this.undoStack.undo(this.app);
      },
    });

    // Add settings tab
    this.addSettingTab(new VaultAISettingTab(this.app, this));

    // Check connection on load
    this.checkConnection();
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_VAULT_AI);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.initializeLLMClient();
    this.checkConnection();
  }

  initializeLLMClient(): void {
    if (this.settings.serverType === 'ollama') {
      this.llmClient = new OllamaClient(
        this.settings.serverUrl,
        this.settings.selectedModel
      );
    } else {
      this.llmClient = new LMStudioClient(
        this.settings.serverUrl,
        this.settings.selectedModel
      );
    }
  }

  async checkConnection(): Promise<void> {
    if (!this.llmClient) {
      this.setConnectionStatus('offline');
      return;
    }

    try {
      const connected = await this.llmClient.isConnected();
      this.setConnectionStatus(connected ? 'ready' : 'offline');
    } catch {
      this.setConnectionStatus('offline');
    }
  }

  setConnectionStatus(status: ConnectionStatus): void {
    this.connectionStatus = status;
    this.updateStatusBar();
    this.updateViews();
  }

  private updateStatusBar(): void {
    if (!this.statusBarItem) return;

    this.statusBarItem.empty();

    const statusText = {
      ready: 'Vault AI: Ready',
      thinking: 'Vault AI: Thinking...',
      offline: 'Vault AI: Offline',
    };

    const statusClass = {
      ready: 'vault-ai-status-ready',
      thinking: 'vault-ai-status-thinking',
      offline: 'vault-ai-status-offline',
    };

    this.statusBarItem.setText(statusText[this.connectionStatus]);
    this.statusBarItem.className = `status-bar-item ${statusClass[this.connectionStatus]}`;

    this.statusBarItem.onClickEvent(() => {
      if (this.connectionStatus === 'offline') {
        // Open settings
        (this.app as any).setting.open();
        (this.app as any).setting.openTabById('vault-ai');
      } else {
        this.activateView();
      }
    });
  }

  private updateViews(): void {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_VAULT_AI);
    for (const leaf of leaves) {
      const view = leaf.view as VaultAIView;
      view.updateConnectionStatus();
    }
  }

  async activateView(
    tab?: 'chat' | 'format' | 'structure',
    scope?: 'current' | 'linked' | 'folder' | 'vault'
  ): Promise<void> {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_VAULT_AI);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_VAULT_AI, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);

      const view = leaf.view as VaultAIView;
      if (tab) {
        view.switchTab(tab);
      }
      if (scope && tab === 'chat') {
        view.setContextScope(scope);
      }
    }
  }
}
