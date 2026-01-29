import { MarkdownRenderer, Notice, TFile, setIcon, Menu, setTooltip } from 'obsidian';
import type VaultAIPlugin from '../main';
import type { VaultAIView } from './SidebarView';
import { ChatMessage, ContextScope, SearchStep, Conversation, LMStudioStreamCallbacks, AgentStep } from '../types';
import { AgenticSearch } from '../search/AgenticSearch';
import { LMStudioClient, LMStudioChatResult } from '../llm/LMStudioClient';
import { ChatAgent } from '../agent/ChatAgent';

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

  // Streaming state
  private streamingMessageEl: HTMLElement | null = null;
  private streamingContentEl: HTMLElement | null = null;
  private streamingReasoningEl: HTMLElement | null = null;
  private streamingContent = '';
  private streamingReasoning = '';

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

    // Add message header with copy button
    const headerEl = messageEl.createDiv('vault-ai-message-header');

    const roleLabel = headerEl.createSpan('vault-ai-message-role');
    roleLabel.setText(message.role === 'user' ? 'You' : 'AI');

    const actionsEl = headerEl.createDiv('vault-ai-message-actions');

    const copyBtn = actionsEl.createEl('button', {
      cls: 'vault-ai-copy-btn clickable-icon',
      attr: { 'aria-label': 'Copy message' },
    });
    setIcon(copyBtn, 'copy');
    setTooltip(copyBtn, 'Copy message');

    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.copyMessageToClipboard(message.content);
    });

    // Add context menu for right-click
    messageEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.showMessageContextMenu(e, message);
    });

    // Render reasoning/thinking first (if present and enabled)
    if (
      this.plugin.settings.showThinkingProcess &&
      message.reasoning
    ) {
      this.renderReasoningContent(messageEl, message.reasoning);
    }

    const contentEl = messageEl.createDiv('vault-ai-message-content');

    // Render markdown content
    MarkdownRenderer.render(
      this.plugin.app,
      message.content,
      contentEl,
      '',
      this.view
    );

    // Render actions performed if present (for agent mode)
    if (message.actionsPerformed && message.actionsPerformed.length > 0) {
      const actionsEl = messageEl.createDiv('vault-ai-actions-performed');
      actionsEl.createEl('strong', { text: 'Actions performed:' });
      const actionsList = actionsEl.createEl('ul');

      for (const action of message.actionsPerformed) {
        actionsList.createEl('li', { text: action, cls: 'vault-ai-action-item' });
      }
    }

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

    // Render search steps thinking process if enabled and present
    if (
      this.plugin.settings.showThinkingProcess &&
      message.searchSteps &&
      message.searchSteps.length > 0
    ) {
      this.renderThinkingProcess(messageEl, message.searchSteps);
    }

    // Render agent steps if enabled and present (for agent mode)
    if (
      this.plugin.settings.showThinkingProcess &&
      message.agentSteps &&
      message.agentSteps.length > 0
    ) {
      this.renderAgentSteps(messageEl, message.agentSteps);
    }
  }

  private renderReasoningContent(parent: HTMLElement, reasoning: string): void {
    const reasoningEl = parent.createDiv('vault-ai-reasoning');

    const header = reasoningEl.createDiv('vault-ai-reasoning-header');
    header.createSpan({ text: 'Thinking' });

    const expandIcon = header.createSpan({ text: '▶', cls: 'expand-icon' });
    const content = reasoningEl.createDiv('vault-ai-reasoning-content');
    content.style.display = 'none';

    // Render reasoning as markdown
    MarkdownRenderer.render(
      this.plugin.app,
      reasoning,
      content,
      '',
      this.view
    );

    header.addEventListener('click', () => {
      const isExpanded = content.style.display !== 'none';
      content.style.display = isExpanded ? 'none' : 'block';
      expandIcon.textContent = isExpanded ? '▶' : '▼';
    });
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

  private copyMessageToClipboard(content: string): void {
    navigator.clipboard.writeText(content).then(() => {
      new Notice('Message copied to clipboard');
    }).catch((err) => {
      console.error('Failed to copy message:', err);
      new Notice('Failed to copy message');
    });
  }

  private showMessageContextMenu(e: MouseEvent, message: ChatMessage): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item.setTitle('Copy message');
      item.setIcon('copy');
      item.onClick(() => {
        this.copyMessageToClipboard(message.content);
      });
    });

    if (message.reasoning) {
      menu.addItem((item) => {
        item.setTitle('Copy thinking');
        item.setIcon('brain');
        item.onClick(() => {
          this.copyMessageToClipboard(message.reasoning!);
        });
      });
    }

    if (message.sources && message.sources.length > 0) {
      menu.addItem((item) => {
        item.setTitle('Copy sources');
        item.setIcon('link');
        item.onClick(() => {
          this.copyMessageToClipboard(message.sources!.join('\n'));
        });
      });
    }

    menu.addSeparator();

    menu.addItem((item) => {
      item.setTitle('Copy all (with metadata)');
      item.setIcon('file-text');
      item.onClick(() => {
        let fullContent = message.content;
        if (message.reasoning) {
          fullContent = `## Thinking\n${message.reasoning}\n\n## Response\n${fullContent}`;
        }
        if (message.sources && message.sources.length > 0) {
          fullContent += `\n\n## Sources\n${message.sources.map(s => `- ${s}`).join('\n')}`;
        }
        this.copyMessageToClipboard(fullContent);
      });
    });

    menu.showAtMouseEvent(e);
  }

  // Streaming message helpers
  private createStreamingMessage(): void {
    if (!this.messagesEl) return;

    this.streamingContent = '';
    this.streamingReasoning = '';

    this.streamingMessageEl = this.messagesEl.createDiv(
      'vault-ai-message vault-ai-message-assistant vault-ai-message-streaming'
    );

    // Create reasoning container (hidden initially)
    if (this.plugin.settings.showThinkingProcess) {
      this.streamingReasoningEl = this.streamingMessageEl.createDiv('vault-ai-reasoning');
      const reasoningHeader = this.streamingReasoningEl.createDiv('vault-ai-reasoning-header');
      reasoningHeader.createSpan({ text: 'Thinking...' });
      const expandIcon = reasoningHeader.createSpan({ text: '▼', cls: 'expand-icon' });
      const reasoningContent = this.streamingReasoningEl.createDiv('vault-ai-reasoning-content');
      reasoningContent.style.display = 'block'; // Show while streaming

      reasoningHeader.addEventListener('click', () => {
        const isExpanded = reasoningContent.style.display !== 'none';
        reasoningContent.style.display = isExpanded ? 'none' : 'block';
        expandIcon.textContent = isExpanded ? '▶' : '▼';
      });

      // Hide until we get reasoning content
      this.streamingReasoningEl.style.display = 'none';
    }

    this.streamingContentEl = this.streamingMessageEl.createDiv('vault-ai-message-content');
    this.streamingContentEl.createSpan({ text: '...', cls: 'vault-ai-typing-indicator' });

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private updateStreamingContent(content: string): void {
    if (!this.streamingContentEl) return;

    this.streamingContent += content;
    this.streamingContentEl.empty();

    // Re-render markdown
    MarkdownRenderer.render(
      this.plugin.app,
      this.streamingContent,
      this.streamingContentEl,
      '',
      this.view
    );

    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  private updateStreamingReasoning(content: string): void {
    if (!this.streamingReasoningEl || !this.plugin.settings.showThinkingProcess) return;

    this.streamingReasoning += content;

    // Show reasoning container
    this.streamingReasoningEl.style.display = 'block';

    const reasoningContent = this.streamingReasoningEl.querySelector('.vault-ai-reasoning-content');
    if (reasoningContent) {
      reasoningContent.empty();
      MarkdownRenderer.render(
        this.plugin.app,
        this.streamingReasoning,
        reasoningContent as HTMLElement,
        '',
        this.view
      );
    }

    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  private finalizeStreamingMessage(): void {
    if (this.streamingMessageEl) {
      this.streamingMessageEl.removeClass('vault-ai-message-streaming');

      // Update reasoning header text
      if (this.streamingReasoningEl) {
        const header = this.streamingReasoningEl.querySelector('.vault-ai-reasoning-header span:first-child');
        if (header) {
          header.textContent = 'Thinking';
        }
        // Collapse reasoning after streaming completes
        const reasoningContent = this.streamingReasoningEl.querySelector('.vault-ai-reasoning-content') as HTMLElement;
        const expandIcon = this.streamingReasoningEl.querySelector('.expand-icon');
        if (reasoningContent && expandIcon) {
          reasoningContent.style.display = 'none';
          expandIcon.textContent = '▶';
        }
      }
    }

    this.streamingMessageEl = null;
    this.streamingContentEl = null;
    this.streamingReasoningEl = null;
  }

  private renderAgentSteps(parent: HTMLElement, steps: AgentStep[]): void {
    const agentEl = parent.createDiv('vault-ai-agent-steps');

    const header = agentEl.createDiv('vault-ai-thinking-header');
    const toolCalls = steps.filter(s => s.type === 'tool_call').length;
    header.createSpan({ text: `Agent activity (${toolCalls} tool calls)` });

    const expandIcon = header.createSpan({ text: '▶', cls: 'expand-icon' });
    const content = agentEl.createDiv('vault-ai-thinking-content');
    content.style.display = 'none';

    header.addEventListener('click', () => {
      const isExpanded = content.style.display !== 'none';
      content.style.display = isExpanded ? 'none' : 'block';
      expandIcon.textContent = isExpanded ? '▶' : '▼';
    });

    let stepNum = 0;
    for (const step of steps) {
      if (step.type === 'tool_call' && step.toolCall) {
        stepNum++;
        const stepEl = content.createDiv('vault-ai-thinking-step');

        const toolName = step.toolCall.tool;
        const statusIcon = step.toolResult?.success ? '✓' : '✗';
        stepEl.createEl('strong', {
          text: `${stepNum}. ${toolName} ${statusIcon}`,
          cls: step.toolResult?.success ? 'tool-success' : 'tool-failure',
        });

        // Show params (abbreviated)
        const paramsStr = Object.entries(step.toolCall.params)
          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 50) : JSON.stringify(v).slice(0, 50)}`)
          .join(', ');
        if (paramsStr) {
          stepEl.createEl('p', { text: paramsStr, cls: 'tool-params' });
        }

        // Show result summary
        if (step.toolResult) {
          const resultText = step.toolResult.result.slice(0, 150);
          stepEl.createEl('p', {
            text: resultText + (step.toolResult.result.length > 150 ? '...' : ''),
            cls: 'tool-result',
          });
        }
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

    // Process message
    this.isProcessing = true;
    this.view.setConnectionStatus('thinking');

    // Check if using LMStudio with new API
    const isLMStudio = this.plugin.settings.serverType === 'lmstudio';

    if (isLMStudio) {
      await this.sendMessageLMStudio(userMessage);
    } else {
      await this.sendMessageLegacy(userMessage);
    }
  }

  private async sendMessageLMStudio(userMessage: string): Promise<void> {
    const lmClient = this.plugin.llmClient as LMStudioClient;

    // Get the previous response ID for conversation continuity
    const previousResponseId = this.plugin.chatHistory.getLMStudioResponseId(
      this.currentConversationId!
    );

    // Create streaming message UI
    this.createStreamingMessage();

    const systemPrompt = `You are a helpful assistant that answers questions based on the user's personal notes.
Be concise and helpful. When answering:
- Directly answer the question based on the provided notes
- Mention which notes contain the relevant information
- If the notes don't contain enough information to fully answer, say so
- Do not make up information that isn't in the notes`;

    // Build context from vault search
    const conversation = this.plugin.chatHistory.getConversation(this.currentConversationId!);
    const scope = conversation?.contextScope || this.plugin.settings.defaultContextScope;

    // Get vault context
    const search = new AgenticSearch(this.plugin);
    const searchResult = await search.search(userMessage, scope);

    // Build input with context
    let input = userMessage;
    if (searchResult.sources.length > 0) {
      input = `Based on the following notes from my vault, please answer this question: "${userMessage}"

--- NOTES FROM VAULT ---

${searchResult.sources.map((s) => `Source: ${s}`).join('\n')}

--- END OF NOTES ---

Please answer the question based on the information found.`;
    }

    try {
      const result = await lmClient.chatV1(input, {
        systemPrompt,
        previousResponseId,
        store: true,
        callbacks: {
          onMessageDelta: (content) => {
            this.updateStreamingContent(content);
          },
          onReasoningDelta: (content) => {
            this.updateStreamingReasoning(content);
          },
          onReasoningStart: () => {
            console.log('[Vault AI] Reasoning started');
          },
          onReasoningEnd: () => {
            console.log('[Vault AI] Reasoning ended');
          },
          onError: (error) => {
            console.error('[Vault AI] Stream error:', error);
            new Notice(`Error: ${error.message}`);
          },
        },
      });

      // Finalize the streaming message
      this.finalizeStreamingMessage();

      // Update the LMStudio response ID for conversation continuity
      if (result.responseId) {
        await this.plugin.chatHistory.updateLMStudioResponseId(
          this.currentConversationId!,
          result.responseId
        );
      }

      // Add assistant message with results
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        sources: searchResult.sources,
        searchSteps: searchResult.steps,
        reasoning: result.reasoning,
      };

      await this.plugin.chatHistory.addMessage(this.currentConversationId!, assistantMsg);
    } catch (error) {
      console.error('LMStudio chat error:', error);
      this.finalizeStreamingMessage();

      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `I encountered an error: ${error}. Please try again.`,
        timestamp: Date.now(),
      };

      await this.plugin.chatHistory.addMessage(this.currentConversationId!, errorMsg);
    } finally {
      this.isProcessing = false;
      this.view.setConnectionStatus('ready');
      this.renderMessages();
    }
  }

  private async sendMessageLegacy(userMessage: string): Promise<void> {
    try {
      const conversation = this.plugin.chatHistory.getConversation(this.currentConversationId!);
      const scope = conversation?.contextScope || this.plugin.settings.defaultContextScope;

      let assistantMsg: ChatMessage;

      if (this.plugin.settings.enableAgentMode) {
        // Use the new ChatAgent with tool capabilities
        const agent = new ChatAgent(this.plugin);
        const result = await agent.execute(userMessage, scope);

        assistantMsg = {
          role: 'assistant',
          content: result.answer,
          timestamp: Date.now(),
          sources: result.sources,
          agentSteps: result.steps,
          actionsPerformed: result.actionsPerformed,
        };
      } else {
        // Use the original agentic search (read-only)
        const search = new AgenticSearch(this.plugin);
        const result = await search.search(userMessage, scope);

        assistantMsg = {
          role: 'assistant',
          content: result.answer,
          timestamp: Date.now(),
          sources: result.sources,
          searchSteps: result.steps,
        };
      }

      await this.plugin.chatHistory.addMessage(this.currentConversationId!, assistantMsg);
    } catch (error) {
      console.error('Chat error:', error);

      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `I encountered an error: ${error}. Please try again.`,
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
