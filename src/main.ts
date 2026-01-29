import { Plugin, WorkspaceLeaf } from 'obsidian';
import { VaultAISettings, DEFAULT_SETTINGS, ConnectionStatus } from './types';
import { VaultAISettingTab } from './settings';
import { LLMClient } from './llm/LLMClient';
import { OllamaClient } from './llm/OllamaClient';
import { LMStudioClient } from './llm/LMStudioClient';
import { VaultAIView, VIEW_TYPE_VAULT_AI } from './ui/SidebarView';
import { ChatWindowView, VIEW_TYPE_CHAT_WINDOW } from './ui/ChatWindowView';
import { UndoStack } from './operations/UndoStack';
import { ChatHistoryManager } from './chat/ChatHistoryManager';
import { ObsidianMCPServer } from './mcp/ObsidianMCPServer';

export default class VaultAIPlugin extends Plugin {
  settings: VaultAISettings = DEFAULT_SETTINGS;
  llmClient: LLMClient | null = null;
  undoStack: UndoStack = new UndoStack();
  connectionStatus: ConnectionStatus = 'offline';
  chatHistory: ChatHistoryManager = null!;
  availableModels: string[] = [];
  mcpServer: ObsidianMCPServer | null = null;

  private statusBarItem: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize chat history manager
    this.chatHistory = new ChatHistoryManager(this);
    await this.chatHistory.load();

    // Initialize LLM client
    this.initializeLLMClient();

    // Register the sidebar view
    this.registerView(VIEW_TYPE_VAULT_AI, (leaf) => new VaultAIView(leaf, this));

    // Register the chat window view
    this.registerView(VIEW_TYPE_CHAT_WINDOW, (leaf) => new ChatWindowView(leaf, this));

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

    this.addCommand({
      id: 'new-chat',
      name: 'Start new chat',
      callback: async () => {
        await this.startNewChat();
      },
    });

    this.addCommand({
      id: 'open-chat-window',
      name: 'Open chat in new window',
      callback: async () => {
        await this.openChatInNewWindow();
      },
    });

    // Add settings tab
    this.addSettingTab(new VaultAISettingTab(this.app, this));

    // Check connection on load
    this.checkConnection();

    // Start MCP server if enabled
    if (this.settings.mcpServerEnabled) {
      this.startMCPServer();
    }
  }

  async onunload(): Promise<void> {
    // Stop MCP server
    await this.stopMCPServer();

    this.app.workspace.detachLeavesOfType(VIEW_TYPE_VAULT_AI);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT_WINDOW);
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

      // If connected, load available models and auto-select first if none selected
      if (connected) {
        await this.loadAvailableModels();
      }
    } catch {
      this.setConnectionStatus('offline');
    }
  }

  async loadAvailableModels(): Promise<string[]> {
    if (!this.llmClient) {
      this.availableModels = [];
      return [];
    }

    try {
      this.availableModels = await this.llmClient.listModels();

      // Auto-select first model if none is selected
      if (!this.settings.selectedModel && this.availableModels.length > 0) {
        this.settings.selectedModel = this.availableModels[0];
        this.llmClient.setModel(this.availableModels[0]);
        await this.saveData(this.settings);
      }

      return this.availableModels;
    } catch (error) {
      console.error('[Vault AI] Error loading models:', error);
      this.availableModels = [];
      return [];
    }
  }

  async setSelectedModel(model: string): Promise<void> {
    this.settings.selectedModel = model;
    if (this.llmClient) {
      this.llmClient.setModel(model);
    }
    await this.saveSettings();
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

    // Also update chat window views
    const chatLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT_WINDOW);
    for (const leaf of chatLeaves) {
      const view = leaf.view as ChatWindowView;
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

  async startNewChat(): Promise<void> {
    // Create a new conversation and open the sidebar
    const conversation = await this.chatHistory.createConversation(
      this.settings.defaultContextScope
    );
    await this.activateView('chat');
  }

  async openChatInNewWindow(conversationId?: string): Promise<void> {
    const { workspace } = this.app;

    // If no conversation ID provided, create a new one
    let convId = conversationId;
    if (!convId) {
      const conversation = await this.chatHistory.createConversation(
        this.settings.defaultContextScope
      );
      convId = conversation.id;
    }

    // Open in a new leaf (pane)
    const leaf = workspace.getLeaf('tab');
    await leaf.setViewState({
      type: VIEW_TYPE_CHAT_WINDOW,
      active: true,
    });

    // Set the conversation ID on the view
    const view = leaf.view as ChatWindowView;
    view.setConversationId(convId);

    workspace.revealLeaf(leaf);
  }

  /**
   * Start the built-in MCP server
   */
  async startMCPServer(): Promise<void> {
    if (this.mcpServer?.isRunning()) {
      console.log('[Vault AI] MCP server already running');
      return;
    }

    try {
      this.mcpServer = new ObsidianMCPServer(this);
      await this.mcpServer.start();
      console.log(`[Vault AI] MCP server started on port ${this.settings.mcpServerPort}`);
    } catch (error) {
      console.error('[Vault AI] Failed to start MCP server:', error);
      this.mcpServer = null;
    }
  }

  /**
   * Stop the built-in MCP server
   */
  async stopMCPServer(): Promise<void> {
    if (this.mcpServer) {
      await this.mcpServer.stop();
      this.mcpServer = null;
      console.log('[Vault AI] MCP server stopped');
    }
  }

  /**
   * Check if MCP server is running
   */
  isMCPServerRunning(): boolean {
    return this.mcpServer?.isRunning() ?? false;
  }

  /**
   * Get MCP server URL
   */
  getMCPServerUrl(): string | null {
    return this.mcpServer?.getServerUrl() ?? null;
  }
}
