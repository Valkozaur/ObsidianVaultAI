import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, TFile, setIcon, Menu, setTooltip } from 'obsidian';
import type VaultAIPlugin from '../main';
import { ChatMessage, ContextScope, SearchStep, Conversation, LMStudioStreamCallbacks, AgentStep, ToolExecutionResult } from '../types';
import { AgenticSearch } from '../search/AgenticSearch';
import { LMStudioClient, LMStudioChatResult, LMStudioToolChatResult } from '../llm/LMStudioClient';
import { ChatAgent, getOpenAITools } from '../agent/ChatAgent';

export const VIEW_TYPE_CHAT_WINDOW = 'vault-ai-chat-window';

export class ChatWindowView extends ItemView {
  plugin: VaultAIPlugin;
  private conversationId: string | null = null;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private scopeDropdown: HTMLSelectElement | null = null;
  private modelDropdown: HTMLSelectElement | null = null;
  private statusEl: HTMLElement | null = null;
  private isProcessing = false;

  // Streaming state
  private streamingMessageEl: HTMLElement | null = null;
  private streamingContentEl: HTMLElement | null = null;
  private streamingReasoningEl: HTMLElement | null = null;
  private streamingContent = '';
  private streamingReasoning = '';

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

    // Controls container for scope and model selectors
    const controlsContainer = container.createDiv('vault-ai-controls-container');

    // Scope selector
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
      this
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
      this
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
      this
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
        this
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

    // Process message
    this.isProcessing = true;
    this.plugin.setConnectionStatus('thinking');

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

    // Get conversation context
    const conversation = this.getConversation();
    const scope = conversation?.contextScope || this.plugin.settings.defaultContextScope;

    // Check if we should use agent mode with tools
    const useAgentMode = this.plugin.settings.enableAgentMode;

    if (useAgentMode) {
      await this.sendMessageLMStudioWithTools(userMessage, lmClient, scope);
    } else {
      await this.sendMessageLMStudioSimple(userMessage, lmClient, scope);
    }
  }

  /**
   * Send message to LMStudio with tool calling support (agent mode)
   */
  private async sendMessageLMStudioWithTools(
    userMessage: string,
    lmClient: LMStudioClient,
    scope: ContextScope
  ): Promise<void> {
    // Create streaming message UI
    this.createStreamingMessage();

    // Create the agent and tool executor
    const agent = new ChatAgent(this.plugin);
    const toolExecutor = agent.createToolExecutor();

    // Get OpenAI-formatted tools
    const tools = getOpenAITools();

    const systemPrompt = `You are a helpful assistant that helps users manage their Obsidian vault.
You have access to tools that allow you to search, read, create, and modify notes in the vault.

Available tools:
- search_vault: Search for notes containing specific terms
- read_note: Read the full content of a note
- create_note: Create a new note in the vault
- append_to_note: Add content to an existing note
- list_folder: List files and subfolders
- format_note: Analyze and apply formatting improvements
- suggest_restructure: Analyze vault structure and suggest improvements
- rename_file: Rename a file
- rename_folder: Rename a folder
- move_file: Move a file to a different folder
- final_answer: Provide your final response to the user

When you have completed the task or gathered enough information, use the final_answer tool to provide your response.
Be helpful, concise, and always explain what actions you're taking.`;

    const allToolCalls: Array<{
      name: string;
      args: Record<string, unknown>;
      result: ToolExecutionResult;
    }> = [];

    try {
      const result = await lmClient.chatWithTools(userMessage, {
        systemPrompt,
        tools,
        toolExecutor,
        maxToolIterations: this.plugin.settings.maxSearchIterations || 5,
        temperature: 0.7,
        callbacks: {
          onMessageDelta: (content) => {
            this.updateStreamingContent(content);
          },
          onToolCallStart: (toolName, args) => {
            console.log(`[Vault AI] Tool call started: ${toolName}`, args);
            // Update UI to show tool is being called
            this.updateStreamingContent(`\n\n*Calling tool: ${toolName}...*\n\n`);
          },
          onToolCallEnd: (toolName, resultText, success) => {
            console.log(`[Vault AI] Tool call ended: ${toolName}`, { success });
            allToolCalls.push({
              name: toolName,
              args: {},
              result: { success, result: resultText },
            });
          },
          onError: (error) => {
            console.error('[Vault AI] Stream error:', error);
            new Notice(`Error: ${error.message}`);
          },
        },
      });

      // Finalize the streaming message
      this.finalizeStreamingMessage();

      // Check if the result came from a final_answer tool call
      let finalContent = result.content;
      let sources: string[] = [];
      const actionsPerformed: string[] = [];

      // Process tool calls to extract final answer and actions
      for (const tc of result.toolCalls) {
        if (tc.name === 'final_answer') {
          finalContent = (tc.args.answer as string) || finalContent;
          sources = (tc.args.sources as string[]) || [];
        } else if (tc.result.success) {
          // Track actions for non-final_answer tools
          if (tc.name === 'create_note') {
            actionsPerformed.push(`Created note: ${tc.args.folder}/${tc.args.name}.md`);
          } else if (tc.name === 'append_to_note') {
            actionsPerformed.push(`Appended content to: ${tc.args.path}`);
          } else if (tc.name === 'rename_file') {
            actionsPerformed.push(`Renamed file: ${tc.args.path} → ${tc.args.newName}`);
          } else if (tc.name === 'rename_folder') {
            actionsPerformed.push(`Renamed folder: ${tc.args.path} → ${tc.args.newName}`);
          } else if (tc.name === 'move_file') {
            actionsPerformed.push(`Moved file: ${tc.args.sourcePath} → ${tc.args.targetFolder}`);
          }
        }
      }

      // Convert tool calls to agent steps for display
      const agentSteps: AgentStep[] = result.toolCalls.map((tc) => ({
        type: 'tool_call' as const,
        toolCall: {
          tool: tc.name,
          params: tc.args as Record<string, any>,
        },
        toolResult: {
          success: tc.result.success,
          result: tc.result.result,
          data: tc.result.data,
        },
      }));

      // Add assistant message with results
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: finalContent,
        timestamp: Date.now(),
        sources,
        agentSteps,
        actionsPerformed,
      };

      await this.plugin.chatHistory.addMessage(this.conversationId!, assistantMsg);
    } catch (error) {
      console.error('LMStudio tool chat error:', error);
      this.finalizeStreamingMessage();

      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `I encountered an error: ${error}. Please try again.`,
        timestamp: Date.now(),
      };

      await this.plugin.chatHistory.addMessage(this.conversationId!, errorMsg);
    } finally {
      this.isProcessing = false;
      this.plugin.setConnectionStatus('ready');
      this.renderMessages();
    }
  }

  /**
   * Send message to LMStudio without tools (simple mode)
   */
  private async sendMessageLMStudioSimple(
    userMessage: string,
    lmClient: LMStudioClient,
    scope: ContextScope
  ): Promise<void> {
    // Get the previous response ID for conversation continuity
    const previousResponseId = this.plugin.chatHistory.getLMStudioResponseId(
      this.conversationId!
    );

    // Create streaming message UI
    this.createStreamingMessage();

    const systemPrompt = `You are a helpful assistant that answers questions based on the user's personal notes.
Be concise and helpful. When answering:
- Directly answer the question based on the provided notes
- Mention which notes contain the relevant information
- If the notes don't contain enough information to fully answer, say so
- Do not make up information that isn't in the notes`;

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
          this.conversationId!,
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

      await this.plugin.chatHistory.addMessage(this.conversationId!, assistantMsg);
    } catch (error) {
      console.error('LMStudio chat error:', error);
      this.finalizeStreamingMessage();

      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `I encountered an error: ${error}. Please try again.`,
        timestamp: Date.now(),
      };

      await this.plugin.chatHistory.addMessage(this.conversationId!, errorMsg);
    } finally {
      this.isProcessing = false;
      this.plugin.setConnectionStatus('ready');
      this.renderMessages();
    }
  }

  private async sendMessageLegacy(userMessage: string): Promise<void> {
    try {
      const conversation = this.getConversation();
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

      await this.plugin.chatHistory.addMessage(this.conversationId!, assistantMsg);
    } catch (error) {
      console.error('Chat error:', error);

      const errorMsg: ChatMessage = {
        role: 'assistant',
        content: `I encountered an error: ${error}. Please try again.`,
        timestamp: Date.now(),
      };

      await this.plugin.chatHistory.addMessage(this.conversationId!, errorMsg);
    } finally {
      this.isProcessing = false;
      this.plugin.setConnectionStatus('ready');
      this.renderMessages();
    }
  }
}
