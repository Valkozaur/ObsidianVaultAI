import { MarkdownRenderer, Notice, TFile, setIcon, Menu, setTooltip, Modal, App } from 'obsidian';
import type VaultAIPlugin from '../main';
import type { VaultAIView } from './SidebarView';
import { ChatMessage, SearchStep, Conversation, LMStudioStreamCallbacks, AgentStep, ToolCallInfo, ReasoningLevel, LMStudioModelInfo } from '../types';
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
  private modelDropdown: HTMLSelectElement | null = null;
  private reasoningDropdown: HTMLSelectElement | null = null;
  private isProcessing = false;
  private currentConversationId: string | null = null;

  // Streaming state
  private streamingMessageEl: HTMLElement | null = null;
  private streamingContentEl: HTMLElement | null = null;
  private streamingReasoningEl: HTMLElement | null = null;
  private streamingToolCallsEl: HTMLElement | null = null;
  private streamingContent = '';
  private streamingReasoning = '';
  private streamingToolCalls: ToolCallInfo[] = [];

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
    // Controls container for model selector
    const controlsContainer = chatArea.createDiv('vault-ai-controls-container');

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

    // Model management button
    const modelManageBtn = modelContainer.createEl('button', {
      cls: 'vault-ai-model-manage-btn clickable-icon',
      attr: { 'aria-label': 'Manage models' },
    });
    setIcon(modelManageBtn, 'settings');
    setTooltip(modelManageBtn, 'Manage models');
    modelManageBtn.addEventListener('click', () => {
      this.showModelManagementModal();
    });

    // Reasoning selector
    const reasoningContainer = controlsContainer.createDiv('vault-ai-reasoning-container');
    reasoningContainer.createSpan({ text: 'Reasoning: ' });

    this.reasoningDropdown = reasoningContainer.createEl('select', {
      cls: 'vault-ai-reasoning-dropdown',
    });

    this.populateReasoningDropdown();

    this.reasoningDropdown.addEventListener('change', async () => {
      const reasoning = this.reasoningDropdown?.value as ReasoningLevel;
      if (reasoning) {
        this.plugin.settings.reasoning = reasoning;
        await this.plugin.saveSettings();
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
    } else {
      this.currentConversationId = null;
    }
    this.renderMessages();
    this.renderHistoryList();
  }

  private async switchToConversation(conversationId: string): Promise<void> {
    this.currentConversationId = conversationId;
    await this.plugin.chatHistory.setActiveConversation(conversationId);
    this.renderMessages();
    this.renderHistoryList();
  }

  private async createNewConversation(): Promise<void> {
    const conversation = await this.plugin.chatHistory.createConversation('vault');
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

    // Render tool calls if present
    if (
      this.plugin.settings.showThinkingProcess &&
      message.toolCalls &&
      message.toolCalls.length > 0
    ) {
      this.renderToolCalls(messageEl, message.toolCalls);
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

  private renderToolCalls(parent: HTMLElement, toolCalls: ToolCallInfo[]): void {
    const toolsEl = parent.createDiv('vault-ai-tool-calls');

    const header = toolsEl.createDiv('vault-ai-thinking-header');
    header.createSpan({ text: `Tool calls (${toolCalls.length})` });

    const expandIcon = header.createSpan({ text: '▶', cls: 'expand-icon' });
    const content = toolsEl.createDiv('vault-ai-thinking-content');
    content.style.display = 'none';

    header.addEventListener('click', () => {
      const isExpanded = content.style.display !== 'none';
      content.style.display = isExpanded ? 'none' : 'block';
      expandIcon.textContent = isExpanded ? '▶' : '▼';
    });

    for (const tc of toolCalls) {
      const tcEl = content.createDiv('vault-ai-tool-call-item');

      const statusIcon = tc.status === 'success' ? '✓' : tc.status === 'failure' ? '✗' : '⋯';
      const statusClass = tc.status === 'success' ? 'tool-success' : tc.status === 'failure' ? 'tool-failure' : 'tool-pending';

      tcEl.createEl('strong', {
        text: `${statusIcon} ${tc.tool}`,
        cls: statusClass,
      });

      // Show arguments
      const argsStr = Object.entries(tc.arguments)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 50) : JSON.stringify(v).slice(0, 50)}`)
        .join(', ');
      if (argsStr) {
        tcEl.createEl('p', { text: argsStr, cls: 'tool-params' });
      }

      // Show result or error
      if (tc.result) {
        tcEl.createEl('p', {
          text: tc.result.slice(0, 150) + (tc.result.length > 150 ? '...' : ''),
          cls: 'tool-result',
        });
      }
      if (tc.error) {
        tcEl.createEl('p', { text: `Error: ${tc.error}`, cls: 'tool-error' });
      }
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
    this.streamingToolCalls = [];

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

      // Create tool calls container (hidden initially)
      this.streamingToolCallsEl = this.streamingMessageEl.createDiv('vault-ai-tool-calls');
      this.streamingToolCallsEl.style.display = 'none';
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

  private updateStreamingToolCall(tool: string, status: 'pending' | 'running' | 'success' | 'failure', args?: Record<string, unknown>, result?: string, error?: string): void {
    if (!this.streamingToolCallsEl || !this.plugin.settings.showThinkingProcess) return;

    // Find existing tool call or create new one
    let tcInfo = this.streamingToolCalls.find(tc => tc.tool === tool && tc.status === 'running');

    if (!tcInfo) {
      tcInfo = {
        tool,
        arguments: args || {},
        status: 'running',
      };
      this.streamingToolCalls.push(tcInfo);
    }

    // Update the tool call info
    if (args) tcInfo.arguments = args;
    tcInfo.status = status;
    if (result) tcInfo.result = result;
    if (error) tcInfo.error = error;

    // Show the container
    this.streamingToolCallsEl.style.display = 'block';

    // Re-render tool calls
    this.streamingToolCallsEl.empty();

    const header = this.streamingToolCallsEl.createDiv('vault-ai-thinking-header');
    header.createSpan({ text: `Tool calls (${this.streamingToolCalls.length})` });

    const expandIcon = header.createSpan({ text: '▼', cls: 'expand-icon' });
    const content = this.streamingToolCallsEl.createDiv('vault-ai-thinking-content');
    content.style.display = 'block'; // Show while streaming

    header.addEventListener('click', () => {
      const isExpanded = content.style.display !== 'none';
      content.style.display = isExpanded ? 'none' : 'block';
      expandIcon.textContent = isExpanded ? '▶' : '▼';
    });

    for (const tc of this.streamingToolCalls) {
      const tcEl = content.createDiv('vault-ai-tool-call-item');

      const statusIcon = tc.status === 'success' ? '✓' : tc.status === 'failure' ? '✗' : '⋯';
      const statusClass = tc.status === 'success' ? 'tool-success' : tc.status === 'failure' ? 'tool-failure' : 'tool-pending';

      tcEl.createEl('strong', {
        text: `${statusIcon} ${tc.tool}`,
        cls: statusClass,
      });

      const argsStr = Object.entries(tc.arguments)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.slice(0, 50) : JSON.stringify(v).slice(0, 50)}`)
        .join(', ');
      if (argsStr) {
        tcEl.createEl('p', { text: argsStr, cls: 'tool-params' });
      }

      if (tc.result) {
        tcEl.createEl('p', {
          text: tc.result.slice(0, 150) + (tc.result.length > 150 ? '...' : ''),
          cls: 'tool-result',
        });
      }
      if (tc.error) {
        tcEl.createEl('p', { text: `Error: ${tc.error}`, cls: 'tool-error' });
      }
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

      // Collapse tool calls after streaming completes
      if (this.streamingToolCallsEl) {
        const toolContent = this.streamingToolCallsEl.querySelector('.vault-ai-thinking-content') as HTMLElement;
        const expandIcon = this.streamingToolCallsEl.querySelector('.expand-icon');
        if (toolContent && expandIcon) {
          toolContent.style.display = 'none';
          expandIcon.textContent = '▶';
        }
      }
    }

    this.streamingMessageEl = null;
    this.streamingContentEl = null;
    this.streamingReasoningEl = null;
    this.streamingToolCallsEl = null;
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

    // Set processing state early and wrap everything in try/finally
    this.isProcessing = true;
    this.view.setConnectionStatus('thinking');

    try {
      // Ensure selected model is loaded (auto unload/load)
      try {
        await this.plugin.ensureModelLoaded();
      } catch (error) {
        console.error('[Vault AI] Failed to ensure model loaded:', error);
        new Notice(`Failed to load model: ${error}`);
      }

      // Create conversation if none exists
      if (!this.currentConversationId) {
        await this.createNewConversation();
      }

      // Check if this is the first message (for async title generation)
      const conversation = this.plugin.chatHistory.getConversation(this.currentConversationId!);
      const isFirstMessage = conversation && conversation.messages.length === 0;

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

      // Trigger async AI title generation for first message (runs in parallel with response)
      if (isFirstMessage) {
        this.plugin.chatHistory.generateAITitle(
          this.currentConversationId!,
          userMessage,
          () => this.renderHistoryList() // Refresh UI when title is ready
        );
      }

      // Check if MCP is enabled and server is running
      const mcpUrl = this.plugin.getMCPServerUrl();

      if (mcpUrl && this.plugin.settings.mcpEnabled) {
        await this.sendMessageWithMCP(userMessage, mcpUrl);
      } else {
        await this.sendMessageLMStudio(userMessage);
      }
    } catch (error) {
      console.error('Error in sendMessage:', error);
      new Notice(`Error sending message: ${error}`);
    } finally {
      this.isProcessing = false;
      this.view.setConnectionStatus('ready');
    }
  }

  private getCurrentNoteContext(): string {
    const currentFile = this.plugin.app.workspace.getActiveFile();
    if (!currentFile) {
      return '';
    }
    return `\n\nCurrently open note: "${currentFile.path}"
If the user's request relates to "this note" or seems to reference their current context, this is the note they are viewing. You can read this file for more context if needed.`;
  }

  private async sendMessageWithMCP(userMessage: string, mcpUrl: string): Promise<void> {
    const lmClient = this.plugin.llmClient as LMStudioClient;

    // Get the previous response ID for conversation continuity
    const previousResponseId = this.plugin.chatHistory.getLMStudioResponseId(
      this.currentConversationId!
    );

    // Create streaming message UI
    this.createStreamingMessage();

    // Include current note context in system prompt
    const currentNoteContext = this.getCurrentNoteContext();
    const systemPrompt = this.plugin.settings.systemPrompt + currentNoteContext;

    // Get reasoning setting (only pass if not 'auto')
    const reasoning = this.plugin.settings.reasoning !== 'auto'
      ? this.plugin.settings.reasoning as 'off' | 'low' | 'medium' | 'high' | 'on'
      : undefined;

    try {
      const result = await lmClient.chatWithMCP(userMessage, mcpUrl, {
        systemPrompt,
        previousResponseId,
        store: true,
        reasoning,
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
          onToolCallStart: (tool) => {
            console.log('[Vault AI] Tool call started:', tool);
            this.updateStreamingToolCall(tool, 'running');
          },
          onToolCallArguments: (tool, args) => {
            console.log('[Vault AI] Tool call arguments:', tool, args);
            this.updateStreamingToolCall(tool, 'running', args);
          },
          onToolCallSuccess: (tool, output) => {
            console.log('[Vault AI] Tool call success:', tool);
            this.updateStreamingToolCall(tool, 'success', undefined, output);
          },
          onToolCallFailure: (tool, reason) => {
            console.log('[Vault AI] Tool call failure:', tool, reason);
            this.updateStreamingToolCall(tool, 'failure', undefined, undefined, reason);
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

      // Convert tool calls to ToolCallInfo format
      const toolCallInfos: ToolCallInfo[] = result.toolCalls?.map(tc => ({
        tool: tc.tool,
        arguments: tc.arguments,
        status: tc.success ? 'success' as const : 'failure' as const,
        result: tc.output,
        error: tc.error,
      })) || [];

      // Add assistant message with results
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.content,
        timestamp: Date.now(),
        reasoning: result.reasoning,
        toolCalls: toolCallInfos.length > 0 ? toolCallInfos : undefined,
      };

      await this.plugin.chatHistory.addMessage(this.currentConversationId!, assistantMsg);
    } catch (error) {
      console.error('MCP chat error:', error);

      // Capture any content that was streamed before the error
      const partialContent = this.streamingContent || '';
      const partialReasoning = this.streamingReasoning || '';

      this.finalizeStreamingMessage();

      // Wrap error handling in try-catch to ensure state is always reset
      try {
        // Check if this is a prediction history error (LM Studio bug)
        const errorStr = String(error);
        const isPredictionHistoryError = errorStr.includes('shard') || errorStr.includes('prediction history') || errorStr.includes('previous_response');

        if (isPredictionHistoryError) {
          console.warn('[Vault AI] Prediction history error detected, clearing response ID');
          await this.plugin.chatHistory.updateLMStudioResponseId(this.currentConversationId!, undefined as any);
        }

        // If we have partial content, save it instead of just the error
        if (partialContent.trim()) {
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: partialContent,
            timestamp: Date.now(),
            reasoning: partialReasoning || undefined,
          };
          await this.plugin.chatHistory.addMessage(this.currentConversationId!, assistantMsg);

          // Show a notice about the error but don't lose the content
          if (isPredictionHistoryError) {
            new Notice('LM Studio had an internal error, but the response was saved.');
          } else {
            new Notice(`Stream ended with error, but partial response was saved.`);
          }
        } else {
          // No content was streamed, save error message
          const errorMsg: ChatMessage = {
            role: 'assistant',
            content: `I encountered an error: ${error}. Please try again.`,
            timestamp: Date.now(),
          };
          await this.plugin.chatHistory.addMessage(this.currentConversationId!, errorMsg);

          if (isPredictionHistoryError) {
            new Notice('LM Studio conversation history error. The conversation has been reset - please try again.');
          }
        }
      } catch (saveError) {
        console.error('Error saving message after stream error:', saveError);
        new Notice('Failed to save response. Please try again.');
      }
    } finally {
      this.isProcessing = false;
      this.view.setConnectionStatus('ready');
      this.renderMessages();
      this.inputEl?.focus();
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

    // Get current note context
    const currentFile = this.plugin.app.workspace.getActiveFile();
    const currentNoteInfo = currentFile
      ? `\n\nCurrently open note: "${currentFile.path}" - If the user's request seems related to their current context, this is the note they are viewing.`
      : '';

    const systemPrompt = `You are a helpful assistant that answers questions based on the user's personal notes.
Be concise and helpful. When answering:
- Directly answer the question based on the provided notes
- Mention which notes contain the relevant information
- If the notes don't contain enough information to fully answer, say so
- Do not make up information that isn't in the notes${currentNoteInfo}`;

    // Build context from vault search
    const search = new AgenticSearch(this.plugin);
    const searchResult = await search.search(userMessage, 'vault');

    // Build input with context
    let input = userMessage;

    // Add current note context to the input
    const currentNoteContext = currentFile ? `\n\n(Currently open note: "${currentFile.path}")` : '';

    if (searchResult.sources.length > 0) {
      input = `Based on the following notes from my vault, please answer this question: "${userMessage}"${currentNoteContext}

--- NOTES FROM VAULT ---

${searchResult.sources.map((s) => `Source: ${s}`).join('\n')}

--- END OF NOTES ---

Please answer the question based on the information found.`;
    } else if (currentFile) {
      input = `${userMessage}${currentNoteContext}`;
    }

    // Get reasoning setting (only pass if not 'auto')
    const reasoning = this.plugin.settings.reasoning !== 'auto'
      ? this.plugin.settings.reasoning as 'off' | 'low' | 'medium' | 'high' | 'on'
      : undefined;

    try {
      const result = await lmClient.chatV1(input, {
        systemPrompt,
        previousResponseId,
        store: true,
        reasoning,
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

      // Capture any content that was streamed before the error
      const partialContent = this.streamingContent || '';
      const partialReasoning = this.streamingReasoning || '';

      this.finalizeStreamingMessage();

      // Wrap error handling in try-catch to ensure state is always reset
      try {
        // Check if this is a prediction history error (LM Studio bug)
        const errorStr = String(error);
        const isPredictionHistoryError = errorStr.includes('shard') || errorStr.includes('prediction history') || errorStr.includes('previous_response');

        if (isPredictionHistoryError) {
          console.warn('[Vault AI] Prediction history error detected, clearing response ID');
          await this.plugin.chatHistory.updateLMStudioResponseId(this.currentConversationId!, undefined as any);
        }

        // If we have partial content, save it instead of just the error
        if (partialContent.trim()) {
          const assistantMsg: ChatMessage = {
            role: 'assistant',
            content: partialContent,
            timestamp: Date.now(),
            sources: searchResult.sources,
            searchSteps: searchResult.steps,
            reasoning: partialReasoning || undefined,
          };
          await this.plugin.chatHistory.addMessage(this.currentConversationId!, assistantMsg);

          // Show a notice about the error but don't lose the content
          if (isPredictionHistoryError) {
            new Notice('LM Studio had an internal error, but the response was saved.');
          } else {
            new Notice(`Stream ended with error, but partial response was saved.`);
          }
        } else {
          // No content was streamed, save error message
          const errorMsg: ChatMessage = {
            role: 'assistant',
            content: `I encountered an error: ${error}. Please try again.`,
            timestamp: Date.now(),
          };
          await this.plugin.chatHistory.addMessage(this.currentConversationId!, errorMsg);

          if (isPredictionHistoryError) {
            new Notice('LM Studio conversation history error. The conversation has been reset - please try again.');
          }
        }
      } catch (saveError) {
        console.error('Error saving message after stream error:', saveError);
        new Notice('Failed to save response. Please try again.');
      }
    } finally {
      this.isProcessing = false;
      this.view.setConnectionStatus('ready');
      this.renderMessages();
      this.inputEl?.focus();
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
      const modelInfo = this.plugin.getModelInfo(model);
      const isLoaded = modelInfo && modelInfo.loaded_instances.length > 0;
      const displayName = modelInfo?.display_name || model;
      const statusIndicator = isLoaded ? '● ' : '○ ';

      const option = this.modelDropdown.createEl('option', {
        text: `${statusIndicator}${displayName}`,
        value: model,
      });
      if (model === this.plugin.settings.selectedModel) {
        option.selected = true;
      }
    }
  }

  private showModelManagementModal(): void {
    new ModelManagementModal(this.plugin.app, this.plugin, () => {
      this.populateModelDropdown();
    }).open();
  }

  refreshModelDropdown(): void {
    this.populateModelDropdown();
  }

  private populateReasoningDropdown(): void {
    if (!this.reasoningDropdown) return;

    this.reasoningDropdown.empty();

    const reasoningOptions: { value: ReasoningLevel; label: string }[] = [
      { value: 'auto', label: 'Auto' },
      { value: 'off', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'on', label: 'On' },
    ];

    for (const option of reasoningOptions) {
      const optionEl = this.reasoningDropdown.createEl('option', {
        text: option.label,
        value: option.value,
      });
      if (option.value === this.plugin.settings.reasoning) {
        optionEl.selected = true;
      }
    }
  }

  refreshReasoningDropdown(): void {
    this.populateReasoningDropdown();
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

/**
 * Modal for managing models (load/unload)
 */
class ModelManagementModal extends Modal {
  private plugin: VaultAIPlugin;
  private onRefresh: () => void;
  private contentEl: HTMLElement | null = null;
  private isLoading = false;
  private contextLengthInput: HTMLInputElement | null = null;
  private flashAttentionToggle: HTMLInputElement | null = null;

  constructor(app: App, plugin: VaultAIPlugin, onRefresh: () => void) {
    super(app);
    this.plugin = plugin;
    this.onRefresh = onRefresh;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    this.contentEl = contentEl;
    contentEl.addClass('vault-ai-model-modal');

    contentEl.createEl('h2', { text: 'Model Management' });

    const description = contentEl.createEl('p', {
      cls: 'vault-ai-model-modal-description',
    });
    description.setText('Configure load settings and manage models. Click a model to select it.');

    // Load settings section
    this.renderLoadSettings(contentEl);

    // Refresh button
    const headerControls = contentEl.createDiv('vault-ai-model-modal-controls');
    const refreshBtn = headerControls.createEl('button', {
      text: 'Refresh',
      cls: 'vault-ai-refresh-btn',
    });
    setIcon(refreshBtn, 'refresh-cw');
    refreshBtn.addEventListener('click', async () => {
      await this.refreshModels();
    });

    // Model list container
    const listContainer = contentEl.createDiv('vault-ai-model-list');

    // Auto-refresh if no model info available
    if (this.plugin.availableModelsInfo.length === 0) {
      listContainer.createEl('p', {
        text: 'Loading models...',
        cls: 'vault-ai-model-empty',
      });
      await this.refreshModels();
    } else {
      this.renderModelList(listContainer);
    }
  }

  private renderLoadSettings(container: HTMLElement): void {
    const settingsSection = container.createDiv('vault-ai-model-settings');

    settingsSection.createEl('h3', {
      text: 'Load Settings',
      cls: 'vault-ai-model-settings-title',
    });

    // Context length
    const ctxRow = settingsSection.createDiv('vault-ai-model-setting-row');
    const ctxLabel = ctxRow.createEl('label', {
      text: 'Context Length',
      cls: 'vault-ai-model-setting-label',
    });
    ctxLabel.setAttribute('for', 'vault-ai-ctx-length');

    const ctxInputContainer = ctxRow.createDiv('vault-ai-model-setting-input');
    this.contextLengthInput = ctxInputContainer.createEl('input', {
      type: 'number',
      cls: 'vault-ai-model-ctx-input',
      value: String(this.plugin.settings.modelContextLength),
      attr: {
        id: 'vault-ai-ctx-length',
        min: '512',
        max: '131072',
        step: '512',
      },
    });
    ctxInputContainer.createEl('span', {
      text: 'tokens',
      cls: 'vault-ai-model-setting-unit',
    });

    this.contextLengthInput.addEventListener('change', async () => {
      const val = parseInt(this.contextLengthInput!.value, 10);
      if (!isNaN(val) && val >= 512) {
        this.plugin.settings.modelContextLength = val;
        await this.plugin.saveData(this.plugin.settings);
      }
    });

    // Flash attention
    const flashRow = settingsSection.createDiv('vault-ai-model-setting-row');
    const flashLabel = flashRow.createEl('label', {
      text: 'Flash Attention',
      cls: 'vault-ai-model-setting-label',
    });
    flashLabel.setAttribute('for', 'vault-ai-flash-attn');

    const flashInputContainer = flashRow.createDiv('vault-ai-model-setting-input');
    this.flashAttentionToggle = flashInputContainer.createEl('input', {
      type: 'checkbox',
      cls: 'vault-ai-model-flash-toggle',
      attr: { id: 'vault-ai-flash-attn' },
    });
    this.flashAttentionToggle.checked = this.plugin.settings.modelFlashAttention;
    flashInputContainer.createEl('span', {
      text: 'Optimize attention computation (reduces memory, improves speed)',
      cls: 'vault-ai-model-setting-desc',
    });

    this.flashAttentionToggle.addEventListener('change', async () => {
      this.plugin.settings.modelFlashAttention = this.flashAttentionToggle!.checked;
      await this.plugin.saveData(this.plugin.settings);
    });
  }

  private async refreshModels(): Promise<void> {
    if (this.isLoading) return;

    this.isLoading = true;
    try {
      await this.plugin.loadAvailableModels();
      this.onRefresh();

      // Re-render the list
      const listContainer = this.contentEl?.querySelector('.vault-ai-model-list');
      if (listContainer) {
        listContainer.empty();
        this.renderModelList(listContainer as HTMLElement);
      }
    } catch (error) {
      new Notice(`Failed to refresh models: ${error}`);
    } finally {
      this.isLoading = false;
    }
  }

  private renderModelList(container: HTMLElement): void {
    const models = this.plugin.availableModelsInfo.filter(m => m.type === 'llm');

    // Check if we have detailed model info (new API) or just model names (legacy API)
    if (models.length === 0 && this.plugin.availableModels.length > 0) {
      // Legacy API mode - show basic list without load/unload
      const notice = container.createDiv('vault-ai-model-legacy-notice');
      notice.createEl('p', {
        text: 'Model management requires LM Studio 0.3.6 or later.',
        cls: 'vault-ai-model-empty',
      });
      notice.createEl('p', {
        text: 'Available models:',
        cls: 'vault-ai-model-legacy-label',
      });
      const list = notice.createEl('ul', { cls: 'vault-ai-model-legacy-list' });
      for (const modelKey of this.plugin.availableModels) {
        const isSelected = modelKey === this.plugin.settings.selectedModel;
        const li = list.createEl('li', {
          text: `${isSelected ? '● ' : '○ '}${modelKey}`,
          cls: isSelected ? 'selected' : '',
        });
        li.addEventListener('click', async () => {
          await this.plugin.setSelectedModel(modelKey);
          this.onRefresh();
          const listContainer = this.contentEl?.querySelector('.vault-ai-model-list');
          if (listContainer) {
            listContainer.empty();
            this.renderModelList(listContainer as HTMLElement);
          }
        });
      }
      return;
    }

    if (models.length === 0) {
      container.createEl('p', {
        text: 'No models available. Make sure LM Studio is running.',
        cls: 'vault-ai-model-empty',
      });
      return;
    }

    for (const model of models) {
      this.renderModelItem(container, model);
    }
  }

  private renderModelItem(container: HTMLElement, model: LMStudioModelInfo): void {
    const isLoaded = model.loaded_instances.length > 0;
    const isSelected = model.key === this.plugin.settings.selectedModel;

    const item = container.createDiv({
      cls: `vault-ai-model-item ${isLoaded ? 'loaded' : ''} ${isSelected ? 'selected' : ''}`,
    });

    // Model info section
    const infoSection = item.createDiv('vault-ai-model-info');

    const nameRow = infoSection.createDiv('vault-ai-model-name-row');
    const statusDot = nameRow.createSpan({
      cls: `vault-ai-model-status ${isLoaded ? 'loaded' : 'unloaded'}`,
      text: isLoaded ? '●' : '○',
    });
    setTooltip(statusDot, isLoaded ? 'Loaded' : 'Not loaded');

    nameRow.createSpan({
      text: model.display_name,
      cls: 'vault-ai-model-name',
    });

    if (isSelected) {
      nameRow.createSpan({
        text: '(selected)',
        cls: 'vault-ai-model-selected-label',
      });
    }

    // Model details
    const detailsRow = infoSection.createDiv('vault-ai-model-details');
    const details: string[] = [];

    if (model.params_string) {
      details.push(model.params_string);
    }
    if (model.quantization?.name) {
      details.push(model.quantization.name);
    }
    if (model.architecture) {
      details.push(model.architecture);
    }
    const sizeGB = (model.size_bytes / (1024 * 1024 * 1024)).toFixed(1);
    details.push(`${sizeGB} GB`);
    details.push(`Max ctx: ${model.max_context_length.toLocaleString()}`);

    detailsRow.setText(details.join(' • '));

    // Show context length if loaded
    if (isLoaded && model.loaded_instances[0]?.config) {
      const config = model.loaded_instances[0].config;
      const configDetails: string[] = [];
      configDetails.push(`Context: ${config.context_length.toLocaleString()}`);
      if (config.flash_attention !== undefined) {
        configDetails.push(`Flash Attn: ${config.flash_attention ? 'On' : 'Off'}`);
      }
      const configRow = infoSection.createDiv('vault-ai-model-config');
      configRow.setText(configDetails.join(' • '));
    }

    // Action buttons
    const actionsSection = item.createDiv('vault-ai-model-actions');

    if (isLoaded) {
      // Unload button
      const unloadBtn = actionsSection.createEl('button', {
        text: 'Unload',
        cls: 'vault-ai-unload-btn',
      });
      unloadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.unloadModel(model, unloadBtn);
      });
    } else {
      // Load button - uses current settings
      const loadBtn = actionsSection.createEl('button', {
        text: 'Load',
        cls: 'vault-ai-load-btn',
      });
      loadBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.loadModel(model, loadBtn);
      });
    }

    // Click to select model
    item.addEventListener('click', async () => {
      await this.plugin.setSelectedModel(model.key);
      this.onRefresh();

      // Re-render to update selection indicator
      const listContainer = this.contentEl?.querySelector('.vault-ai-model-list');
      if (listContainer) {
        listContainer.empty();
        this.renderModelList(listContainer as HTMLElement);
      }
    });
  }

  private async loadModel(model: LMStudioModelInfo, button: HTMLButtonElement): Promise<void> {
    if (this.isLoading) return;

    this.isLoading = true;
    const originalText = button.textContent;
    button.textContent = 'Loading...';
    button.disabled = true;

    try {
      // Read current settings from inputs
      const contextLength = this.contextLengthInput
        ? parseInt(this.contextLengthInput.value, 10)
        : this.plugin.settings.modelContextLength;
      const flashAttention = this.flashAttentionToggle
        ? this.flashAttentionToggle.checked
        : this.plugin.settings.modelFlashAttention;

      await this.plugin.loadModel(model.key, {
        context_length: contextLength,
        flash_attention: flashAttention,
      });

      // Also select this model
      await this.plugin.setSelectedModel(model.key);

      new Notice(`Model "${model.display_name}" loaded (ctx: ${contextLength.toLocaleString()}, flash: ${flashAttention ? 'on' : 'off'})`);
      this.onRefresh();

      // Re-render the list
      const listContainer = this.contentEl?.querySelector('.vault-ai-model-list');
      if (listContainer) {
        listContainer.empty();
        this.renderModelList(listContainer as HTMLElement);
      }
    } catch (error) {
      new Notice(`Failed to load model: ${error}`);
      button.textContent = originalText;
      button.disabled = false;
    } finally {
      this.isLoading = false;
    }
  }

  private async unloadModel(model: LMStudioModelInfo, button: HTMLButtonElement): Promise<void> {
    if (this.isLoading) return;

    if (model.loaded_instances.length === 0) {
      new Notice('Model is not loaded');
      return;
    }

    this.isLoading = true;
    const originalText = button.textContent;
    button.textContent = 'Unloading...';
    button.disabled = true;

    try {
      // Unload all instances
      for (const instance of model.loaded_instances) {
        await this.plugin.unloadModel(instance.id);
      }
      new Notice(`Model "${model.display_name}" unloaded`);
      this.onRefresh();

      // Re-render the list
      const listContainer = this.contentEl?.querySelector('.vault-ai-model-list');
      if (listContainer) {
        listContainer.empty();
        this.renderModelList(listContainer as HTMLElement);
      }
    } catch (error) {
      new Notice(`Failed to unload model: ${error}`);
      button.textContent = originalText;
      button.disabled = false;
    } finally {
      this.isLoading = false;
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
