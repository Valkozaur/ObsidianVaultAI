import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, TFile, setIcon, Menu } from 'obsidian';
import type VaultAIPlugin from '../main';
import { ChatMessage, ContextScope, SearchStep, Conversation } from '../types';
import { AgenticSearch } from '../search/AgenticSearch';

export const VIEW_TYPE_CHAT_WINDOW = 'vault-ai-chat-window';

export class ChatWindowView extends ItemView {
  plugin: VaultAIPlugin;
  private conversationId: string | null = null;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private scopeDropdown: HTMLSelectElement | null = null;
  private statusEl: HTMLElement | null = null;
  private isProcessing = false;

  constructor(leaf: WorkspaceLeaf, plugin: VaultAIPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT_WINDOW;
  }

  getDisplayText(): string {
    const conversation = this.getConversation();
    return conversation ? `Chat: ${conversation.title}` : 'Chat Window';
  }

  getIcon(): string {
    return 'message-square';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass('vault-ai-chat-window-container');

    // Header
    const header = container.createDiv('vault-ai-chat-window-header');

    const titleContainer = header.createDiv('vault-ai-chat-window-title-container');
    const titleEl = titleContainer.createEl('h4', { text: this.getDisplayText() });

    // Edit title button
    const editBtn = titleContainer.createEl('button', {
      cls: 'vault-ai-chat-window-edit-btn',
      attr: { 'aria-label': 'Rename conversation' },
    });
    setIcon(editBtn, 'pencil');
    editBtn.addEventListener('click', () => this.renameConversation());

    this.statusEl = header.createSpan('vault-ai-status');
    this.updateConnectionStatus();

    // Scope selector
    const scopeContainer = container.createDiv('vault-ai-scope-container');
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
      this.scopeDropdown.createEl('option', {
        text: scope.label,
        value: scope.value,
      });
    }

    this.scopeDropdown.addEventListener('change', async () => {
      const scope = this.scopeDropdown?.value as ContextScope;
      if (this.conversationId) {
        await this.plugin.chatHistory.updateConversationScope(this.conversationId, scope);
      }
    });

    // Messages container
    this.messagesEl = container.createDiv('vault-ai-messages');

    // Input area
    const inputContainer = container.createDiv('vault-ai-input-container');

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

    // Load conversation if set
    this.renderMessages();
  }

  async onClose(): Promise<void> {
    // Cleanup
  }

  setConversationId(id: string): void {
    this.conversationId = id;
    const conversation = this.getConversation();
    if (conversation && this.scopeDropdown) {
      this.scopeDropdown.value = conversation.contextScope;
    }
    this.renderMessages();
    this.updateDisplayedTitle();
  }

  private getConversation(): Conversation | undefined {
    if (!this.conversationId) return undefined;
    return this.plugin.chatHistory.getConversation(this.conversationId);
  }

  private async renameConversation(): Promise<void> {
    const conversation = this.getConversation();
    if (!conversation) return;

    const newTitle = prompt('Enter new title:', conversation.title);
    if (newTitle !== null) {
      await this.plugin.chatHistory.renameConversation(conversation.id, newTitle);
      this.updateDisplayedTitle();
    }
  }

  private updateDisplayedTitle(): void {
    const conversation = this.getConversation();
    const title = conversation ? conversation.title : 'Chat Window';
    const titleEl = this.containerEl.querySelector('.vault-ai-chat-window-title-container h4');
    if (titleEl) {
      titleEl.textContent = title;
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

  private renderMessages(): void {
    if (!this.messagesEl) return;
    this.messagesEl.empty();

    const conversation = this.getConversation();
    const messages = conversation?.messages || [];

    if (messages.length === 0) {
      const emptyState = this.messagesEl.createDiv('vault-ai-empty-state');
      emptyState.createEl('p', {
        text: "Ask questions about your notes and I'll search through your vault to find answers.",
      });
      emptyState.createEl('p', {
        text: 'Try: "What have I written about project planning?" or "Summarize my notes on JavaScript"',
        cls: 'vault-ai-hint',
      });
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
      this
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
    if (!this.inputEl || this.isProcessing || !this.conversationId) return;

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

    // Add user message
    const userMsg: ChatMessage = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    };

    await this.plugin.chatHistory.addMessage(this.conversationId, userMsg);

    this.inputEl.value = '';
    this.renderMessages();

    // Update displayed title if this is the first message
    this.updateDisplayedTitle();

    // Process with agentic search
    this.isProcessing = true;
    this.plugin.setConnectionStatus('thinking');

    try {
      const conversation = this.getConversation();
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

      await this.plugin.chatHistory.addMessage(this.conversationId, assistantMsg);
    } catch (error) {
      console.error('Chat error:', error);

      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `I encountered an error while searching: ${error}. Please try again.`,
        timestamp: Date.now(),
      };

      await this.plugin.chatHistory.addMessage(this.conversationId, errorMsg);
    } finally {
      this.isProcessing = false;
      this.plugin.setConnectionStatus('ready');
      this.renderMessages();
    }
  }
}
