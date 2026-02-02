import { Plugin, WorkspaceLeaf } from 'obsidian';
import { VaultAISettings, DEFAULT_SETTINGS, ConnectionStatus, LMStudioModelInfo } from './types';
import { VaultAISettingTab } from './settings';
import { LLMClient } from './llm/LLMClient';
import { LMStudioClient } from './llm/LMStudioClient';
import { VaultAIView, VIEW_TYPE_VAULT_AI } from './ui/SidebarView';
import { ChatWindowView, VIEW_TYPE_CHAT_WINDOW } from './ui/ChatWindowView';
import { UndoStack } from './operations/UndoStack';
import { ChatHistoryManager } from './chat/ChatHistoryManager';
import { MCPServer } from './mcp';

export default class VaultAIPlugin extends Plugin {
  settings: VaultAISettings = DEFAULT_SETTINGS;
  llmClient: LLMClient | null = null;
  undoStack: UndoStack = new UndoStack();
  connectionStatus: ConnectionStatus = 'offline';
  chatHistory: ChatHistoryManager = null!;
  availableModels: string[] = [];
  availableModelsInfo: LMStudioModelInfo[] = [];
  mcpServer: MCPServer | null = null;

  private statusBarItem: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize chat history manager
    this.chatHistory = new ChatHistoryManager(this);
    await this.chatHistory.load();

    // Initialize LLM client
    this.initializeLLMClient();

    // Start MCP server if enabled
    if (this.settings.mcpEnabled) {
      await this.startMCPServer();
    }

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
      name: 'Ask about vault',
      callback: () => {
        this.activateView('chat');
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
    this.llmClient = new LMStudioClient(
      this.settings.serverUrl,
      this.settings.selectedModel
    );
  }

  async startMCPServer(): Promise<void> {
    if (this.mcpServer?.isRunning()) {
      console.log('[Vault AI] MCP server already running');
      return;
    }

    try {
      this.mcpServer = new MCPServer(this, this.settings.mcpPort);
      await this.mcpServer.start();
      console.log(`[Vault AI] MCP server started on port ${this.settings.mcpPort}`);
    } catch (error) {
      console.error('[Vault AI] Failed to start MCP server:', error);
      this.mcpServer = null;
    }
  }

  async stopMCPServer(): Promise<void> {
    if (this.mcpServer) {
      await this.mcpServer.stop();
      this.mcpServer = null;
      console.log('[Vault AI] MCP server stopped');
    }
  }

  getMCPServerUrl(): string | undefined {
    if (this.mcpServer?.isRunning()) {
      return this.mcpServer.getUrl();
    }
    return undefined;
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
      this.availableModelsInfo = [];
      return [];
    }

    const lmClient = this.llmClient as LMStudioClient;

    // Try the new API first for full model info
    try {
      this.availableModelsInfo = await lmClient.listModelsV1();

      // Filter to only LLM models and extract keys for backwards compatibility
      const llmModels = this.availableModelsInfo.filter(m => m.type === 'llm');
      this.availableModels = llmModels.map(m => m.key);

      // Auto-select first loaded model if none is selected, or first available model
      if (!this.settings.selectedModel && this.availableModels.length > 0) {
        // Prefer a loaded model
        const loadedModel = llmModels.find(m => m.loaded_instances.length > 0);
        const selectedModel = loadedModel?.key || this.availableModels[0];
        this.settings.selectedModel = selectedModel;
        this.llmClient.setModel(selectedModel);
        await this.saveData(this.settings);
      }

      return this.availableModels;
    } catch (error) {
      console.error('[Vault AI] New API failed, falling back to legacy:', error);
    }

    // Fallback to legacy API if new API fails
    try {
      this.availableModels = await lmClient.listModels();
      this.availableModelsInfo = []; // No detailed info available with legacy API

      if (!this.settings.selectedModel && this.availableModels.length > 0) {
        this.settings.selectedModel = this.availableModels[0];
        this.llmClient.setModel(this.availableModels[0]);
        await this.saveData(this.settings);
      }

      return this.availableModels;
    } catch (error) {
      console.error('[Vault AI] Error loading models:', error);
      this.availableModels = [];
      this.availableModelsInfo = [];
      return [];
    }
  }

  /**
   * Load a model into memory
   */
  async loadModel(modelKey: string): Promise<void> {
    if (!this.llmClient) {
      throw new Error('LLM client not initialized');
    }

    const lmClient = this.llmClient as LMStudioClient;
    await lmClient.loadModel(modelKey);

    // Refresh model list to update loaded status
    await this.loadAvailableModels();
    this.updateViews();
  }

  /**
   * Unload a model from memory
   */
  async unloadModel(instanceId: string): Promise<void> {
    if (!this.llmClient) {
      throw new Error('LLM client not initialized');
    }

    const lmClient = this.llmClient as LMStudioClient;
    await lmClient.unloadModel(instanceId);

    // Refresh model list to update loaded status
    await this.loadAvailableModels();
    this.updateViews();
  }

  /**
   * Get detailed info for a specific model
   */
  getModelInfo(modelKey: string): LMStudioModelInfo | undefined {
    return this.availableModelsInfo.find(m => m.key === modelKey);
  }

  /**
   * Check if a model is currently loaded
   */
  isModelLoaded(modelKey: string): boolean {
    const model = this.getModelInfo(modelKey);
    return model ? model.loaded_instances.length > 0 : false;
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

  async activateView(tab?: 'chat' | 'format' | 'structure'): Promise<void> {
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
    }
  }

  async startNewChat(): Promise<void> {
    // Create a new conversation and open the sidebar
    await this.chatHistory.createConversation('vault');
    await this.activateView('chat');
  }

  async openChatInNewWindow(conversationId?: string): Promise<void> {
    const { workspace } = this.app;

    // If no conversation ID provided, create a new one
    let convId = conversationId;
    if (!convId) {
      const conversation = await this.chatHistory.createConversation('vault');
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
}
