import { MarkdownRenderer, Notice, TFile, setIcon, Menu } from 'obsidian';
import type VaultAIPlugin from '../main';
import type { VaultAIView } from './SidebarView';
import { ChatMessage, ContextScope, SearchStep, Conversation } from '../types';
import { AgenticSearch } from '../search/AgenticSearch';

export class ChatTab {
  private plugin: VaultAIPlugin;
  private view: VaultAIView;
  private containerEl: HTMLElement | null = null;
  private historyListEl: HTMLElement | null = null;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private scopeDropdown: HTMLSelectElement | null = null;
  private modelDropdown: HTMLSelectElement | null = null;
  private isProcessing = false;
  private currentConversationId: string | null = null;

  constructor(plugin: VaultAIPlugin, view: VaultAIView) {
    this.plugin = plugin;
    this.view = view;
  }

  render(container: HTMLElement): void {
    this.containerEl = container;
    container.addClass('vault-ai-chat-tab');

    // Main layout: history sidebar + chat area
    const mainLayout = container.createDiv('vault-ai-chat-layout');

    // History sidebar
    const historySidebar = mainLayout.createDiv('vault-ai-history-sidebar');
    this.renderHistorySidebar(historySidebar);

    // Chat area
    const chatArea = mainLayout.createDiv('vault-ai-chat-area');
    this.renderChatArea(chatArea);

    // Load active conversation or show empty state
    this.loadActiveConversation();
  }

  private renderHistorySidebar(sidebar: HTMLElement): void {
    // Header with "New Chat" button
    const header = sidebar.createDiv('vault-ai-history-header');
    header.createSpan({ text: 'Chat History', cls: 'vault-ai-history-title' });

    const newChatBtn = header.createEl('button', {
      cls: 'vault-ai-new-chat-btn',
      attr: { 'aria-label': 'New Chat' },
    });
    setIcon(newChatBtn, 'plus');
    newChatBtn.addEventListener('click', () => this.createNewConversation());

    // Conversation list
    this.historyListEl = sidebar.createDiv('vault-ai-history-list');
    this.renderHistoryList();
  }

  private renderHistoryList(): void {
    if (!this.historyListEl) return;
    this.historyListEl.empty();

    const conversations = this.plugin.chatHistory.getConversations();

    if (conversations.length === 0) {
      const emptyEl = this.historyListEl.createDiv('vault-ai-history-empty');
      emptyEl.createSpan({ text: 'No conversations yet' });
      return;
    }

    for (const conversation of conversations) {
      this.renderHistoryItem(conversation);
    }
  }

  private renderHistoryItem(conversation: Conversation): void {
    if (!this.historyListEl) return;

    const item = this.historyListEl.createDiv({
      cls: `vault-ai-history-item ${conversation.id === this.currentConversationId ? 'active' : ''}`,
    });

    const titleEl = item.createDiv('vault-ai-history-item-title');
    titleEl.setText(conversation.title);

    const dateEl = item.createDiv('vault-ai-history-item-date');
    dateEl.setText(this.formatDate(conversation.updatedAt));

    // Click to select conversation
    item.addEventListener('click', () => {
      this.switchToConversation(conversation.id);
    });

    // Right-click context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showConversationMenu(e, conversation);
    });
  }

  private showConversationMenu(e: MouseEvent, conversation: Conversation): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item.setTitle('Rename');
      item.setIcon('pencil');
      item.onClick(async () => {
        const newTitle = prompt('Enter new title:', conversation.title);
        if (newTitle !== null) {
          await this.plugin.chatHistory.renameConversation(conversation.id, newTitle);
          this.renderHistoryList();
        }
      });
    });

    menu.addItem((item) => {
      item.setTitle('Open in new window');
      item.setIcon('external-link');
      item.onClick(() => {
        this.plugin.openChatInNewWindow(conversation.id);
      });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item.setTitle('Delete');
      item.setIcon('trash-2');
      item.onClick(async () => {
        if (confirm('Delete this conversation?')) {
          await this.plugin.chatHistory.deleteConversation(conversation.id);
          if (this.currentConversationId === conversation.id) {
            this.currentConversationId = null;
            this.loadActiveConversation();
          }
          this.renderHistoryList();
        }
      });
    });

    menu.showAtMouseEvent(e);
  }

  private renderChatArea(chatArea: HTMLElement): void {
    // Controls container for scope and model selectors
    const controlsContainer = chatArea.createDiv('vault-ai-controls-container');

    // Context scope selector
    const scopeContainer = controlsContainer.createDiv('vault-ai-scope-container');
    scopeContainer.createSpan({ text: 'Context: ' });

    this.scopeDropdown = scopeContainer.createEl('select', {
      cls: 'vault-ai-scope-dropdown',
    });

    const scopes: { value: ContextScope; label: string }[] = [
      { value: 'current', label: 'Current Note' },
      { value: 'linked', label: 'Linked Notes' },
      { value: 'folder', label: 'Current Folder' },
      { value: 'vault', label: 'Entire Vault' },
    ];

    for (const scope of scopes) {
      const option = this.scopeDropdown.createEl('option', {
        text: scope.label,
        value: scope.value,
      });
      if (scope.value === this.plugin.settings.defaultContextScope) {
        option.selected = true;
      }
    }

    this.scopeDropdown.addEventListener('change', async () => {
      const scope = this.scopeDropdown?.value as ContextScope;
      if (this.currentConversationId) {
        await this.plugin.chatHistory.updateConversationScope(
          this.currentConversationId,
          scope
        );
      }
    });

    // Model selector
    const modelContainer = controlsContainer.createDiv('vault-ai-model-container');
    modelContainer.createSpan({ text: 'Model: ' });

    this.modelDropdown = modelContainer.createEl('select', {
      cls: 'vault-ai-model-dropdown',
    });

    this.populateModelDropdown();

    this.modelDropdown.addEventListener('change', async () => {
      const model = this.modelDropdown?.value;
      if (model) {
        await this.plugin.setSelectedModel(model);
      }
    });

    // Messages container
    this.messagesEl = chatArea.createDiv('vault-ai-messages');

    // Input area
    const inputContainer = chatArea.createDiv('vault-ai-input-container');

    this.inputEl = inputContainer.createEl('textarea', {
      cls: 'vault-ai-input',
      attr: {
        placeholder: 'Ask a question about your vault...',
        rows: '3',
      },
    });

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    const sendButton = inputContainer.createEl('button', {
      text: 'Send',
      cls: 'vault-ai-send-button',
    });

    sendButton.addEventListener('click', () => {
      this.sendMessage();
    });
  }

  private async loadActiveConversation(): Promise<void> {
    const active = this.plugin.chatHistory.getActiveConversation();
    if (active) {
      this.currentConversationId = active.id;
      if (this.scopeDropdown) {
        this.scopeDropdown.value = active.contextScope;
      }
    } else {
      this.currentConversationId = null;
    }
    this.renderMessages();
    this.renderHistoryList();
  }

  private async switchToConversation(conversationId: string): Promise<void> {
    this.currentConversationId = conversationId;
    await this.plugin.chatHistory.setActiveConversation(conversationId);

    const conversation = this.plugin.chatHistory.getConversation(conversationId);
    if (conversation && this.scopeDropdown) {
      this.scopeDropdown.value = conversation.contextScope;
    }

    this.renderMessages();
    this.renderHistoryList();
  }

  private async createNewConversation(): Promise<void> {
    const scope = (this.scopeDropdown?.value as ContextScope) || this.plugin.settings.defaultContextScope;
    const conversation = await this.plugin.chatHistory.createConversation(scope);
    this.currentConversationId = conversation.id;
    this.renderMessages();
    this.renderHistoryList();
    this.inputEl?.focus();
  }

  private getCurrentMessages(): ChatMessage[] {
    if (!this.currentConversationId) return [];
    const conversation = this.plugin.chatHistory.getConversation(this.currentConversationId);
    return conversation?.messages || [];
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;
    this.messagesEl.empty();

    const messages = this.getCurrentMessages();

    if (messages.length === 0) {
      const emptyState = this.messagesEl.createDiv('vault-ai-empty-state');
      emptyState.createEl('p', {
        text: "Ask questions about your notes and I'll search through your vault to find answers.",
      });
      emptyState.createEl('p', {
        text: 'Try: "What have I written about project planning?" or "Summarize my notes on JavaScript"',
        cls: 'vault-ai-hint',
      });

      if (!this.currentConversationId) {
        const startBtn = emptyState.createEl('button', {
          text: 'Start a new conversation',
          cls: 'vault-ai-start-btn',
        });
        startBtn.addEventListener('click', () => this.createNewConversation());
      }
      return;
    }

    for (const message of messages) {
      this.renderMessage(message);
    }

    // Scroll to bottom
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private renderMessage(message: ChatMessage): void {
    if (!this.messagesEl) return;

    const messageEl = this.messagesEl.createDiv(
      `vault-ai-message vault-ai-message-${message.role}`
    );

    const contentEl = messageEl.createDiv('vault-ai-message-content');

    // Render markdown content
    MarkdownRenderer.render(
      this.plugin.app,
      message.content,
      contentEl,
      '',
      this.view
    );

    // Render sources if present
    if (message.sources && message.sources.length > 0) {
      const sourcesEl = messageEl.createDiv('vault-ai-sources');
      sourcesEl.createEl('strong', { text: 'Sources:' });
      const sourcesList = sourcesEl.createEl('ul');

      for (const source of message.sources) {
        const li = sourcesList.createEl('li');
        const link = li.createEl('a', {
          text: source.split('/').pop() || source,
          cls: 'vault-ai-source-link',
        });

        link.addEventListener('click', async (e) => {
          e.preventDefault();
          const file = this.plugin.app.vault.getAbstractFileByPath(source);
          if (file instanceof TFile) {
            await this.plugin.app.workspace.getLeaf().openFile(file);
          }
        });
      }
    }

    // Render thinking process if enabled and present
    if (
      this.plugin.settings.showThinkingProcess &&
      message.searchSteps &&
      message.searchSteps.length > 0
    ) {
      this.renderThinkingProcess(messageEl, message.searchSteps);
    }
  }

  private renderThinkingProcess(parent: HTMLElement, steps: SearchStep[]): void {
    const thinkingEl = parent.createDiv('vault-ai-thinking');

    const header = thinkingEl.createDiv('vault-ai-thinking-header');
    header.createSpan({ text: `Search process (${steps.length} steps)` });

    const expandIcon = header.createSpan({ text: '▶', cls: 'expand-icon' });
    const content = thinkingEl.createDiv('vault-ai-thinking-content');
    content.style.display = 'none';

    header.addEventListener('click', () => {
      const isExpanded = content.style.display !== 'none';
      content.style.display = isExpanded ? 'none' : 'block';
      expandIcon.textContent = isExpanded ? '▶' : '▼';
    });

    for (const step of steps) {
      const stepEl = content.createDiv('vault-ai-thinking-step');
      stepEl.createEl('strong', { text: `Step ${step.iteration}: ${step.action}` });

      if (step.query) {
        stepEl.createEl('p', { text: `Query: "${step.query}"` });
      }

      stepEl.createEl('p', { text: step.reasoning, cls: 'reasoning' });

      if (step.results && step.results.length > 0) {
        stepEl.createEl('p', {
          text: `Found ${step.results.length} file(s) with matches`,
          cls: 'results-count',
        });
      }
    }
  }

  async sendMessage(): Promise<void> {
    if (!this.inputEl || this.isProcessing) return;

    const userMessage = this.inputEl.value.trim();
    if (!userMessage) return;

    if (this.plugin.connectionStatus === 'offline') {
      new Notice('Not connected to LLM server. Check your settings.');
      return;
    }

    if (!this.plugin.settings.selectedModel) {
      new Notice('No model selected. Please select a model in settings.');
      return;
    }

    // Create conversation if none exists
    if (!this.currentConversationId) {
      await this.createNewConversation();
    }

    // Add user message
    const userMsg: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };

    await this.plugin.chatHistory.addMessage(this.currentConversationId!, userMsg);

    this.inputEl.value = '';
    this.renderMessages();
    this.renderHistoryList(); // Update title if changed

    // Process with agentic search
    this.isProcessing = true;
    this.view.setConnectionStatus('thinking');

    try {
      const conversation = this.plugin.chatHistory.getConversation(this.currentConversationId!);
      const scope = conversation?.contextScope || this.plugin.settings.defaultContextScope;

      const search = new AgenticSearch(this.plugin);
      const result = await search.search(userMessage, scope);

      // Add assistant message with results
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.answer,
        timestamp: Date.now(),
        sources: result.sources,
        searchSteps: result.steps,
      };

      await this.plugin.chatHistory.addMessage(this.currentConversationId!, assistantMsg);
    } catch (error) {
      console.error('Chat error:', error);

      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `I encountered an error while searching: ${error}. Please try again.`,
        timestamp: Date.now(),
      };

      await this.plugin.chatHistory.addMessage(this.currentConversationId!, errorMsg);
    } finally {
      this.isProcessing = false;
      this.view.setConnectionStatus('ready');
      this.renderMessages();
    }
  }

  setScope(scope: ContextScope): void {
    if (this.scopeDropdown) {
      this.scopeDropdown.value = scope;
    }
    if (this.currentConversationId) {
      this.plugin.chatHistory.updateConversationScope(this.currentConversationId, scope);
    }
  }

  focusInput(): void {
    this.inputEl?.focus();
  }

  async populateModelDropdown(): Promise<void> {
    if (!this.modelDropdown) return;

    this.modelDropdown.empty();

    // Use cached models if available, otherwise fetch
    let models = this.plugin.availableModels;
    if (models.length === 0) {
      this.modelDropdown.createEl('option', {
        text: 'Loading...',
        value: '',
      });

      models = await this.plugin.loadAvailableModels();
      this.modelDropdown.empty();
    }

    if (models.length === 0) {
      this.modelDropdown.createEl('option', {
        text: 'No models available',
        value: '',
      });
      return;
    }

    for (const model of models) {
      const option = this.modelDropdown.createEl('option', {
        text: model,
        value: model,
      });
      if (model === this.plugin.settings.selectedModel) {
        option.selected = true;
      }
    }
  }

  refreshModelDropdown(): void {
    this.populateModelDropdown();
  }

  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  // Load a specific conversation (used when opening from new window)
  async loadConversation(conversationId: string): Promise<void> {
    await this.switchToConversation(conversationId);
  }
}
