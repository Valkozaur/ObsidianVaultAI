import { MarkdownRenderer, Notice, TFile } from 'obsidian';
import type VaultAIPlugin from '../main';
import type { VaultAIView } from './SidebarView';
import { ChatMessage, ContextScope, SearchStep } from '../types';
import { AgenticSearch } from '../search/AgenticSearch';
import { CHAT_SYSTEM_PROMPT } from '../prompts/chat';

export class ChatTab {
  private plugin: VaultAIPlugin;
  private view: VaultAIView;
  private messages: ChatMessage[] = [];
  private currentScope: ContextScope;
  private containerEl: HTMLElement | null = null;
  private messagesEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private scopeDropdown: HTMLSelectElement | null = null;
  private isProcessing = false;

  constructor(plugin: VaultAIPlugin, view: VaultAIView) {
    this.plugin = plugin;
    this.view = view;
    this.currentScope = plugin.settings.defaultContextScope;
  }

  render(container: HTMLElement): void {
    this.containerEl = container;
    container.addClass('vault-ai-chat-tab');

    // Context scope selector
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
      const option = this.scopeDropdown.createEl('option', {
        text: scope.label,
        value: scope.value,
      });
      if (scope.value === this.currentScope) {
        option.selected = true;
      }
    }

    this.scopeDropdown.addEventListener('change', () => {
      this.currentScope = this.scopeDropdown?.value as ContextScope;
    });

    // Messages container
    this.messagesEl = container.createDiv('vault-ai-messages');
    this.renderMessages();

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
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;
    this.messagesEl.empty();

    if (this.messages.length === 0) {
      const emptyState = this.messagesEl.createDiv('vault-ai-empty-state');
      emptyState.createEl('p', {
        text: 'Ask questions about your notes and I\'ll search through your vault to find answers.',
      });
      emptyState.createEl('p', {
        text: 'Try: "What have I written about project planning?" or "Summarize my notes on JavaScript"',
        cls: 'vault-ai-hint',
      });
      return;
    }

    for (const message of this.messages) {
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

    // Add user message
    this.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
    });

    this.inputEl.value = '';
    this.renderMessages();

    // Process with agentic search
    this.isProcessing = true;
    this.view.setConnectionStatus('thinking');

    try {
      const search = new AgenticSearch(this.plugin);
      const result = await search.search(userMessage, this.currentScope);

      // Add assistant message with results
      this.messages.push({
        role: 'assistant',
        content: result.answer,
        timestamp: Date.now(),
        sources: result.sources,
        searchSteps: result.steps,
      });
    } catch (error) {
      console.error('Chat error:', error);

      this.messages.push({
        role: 'assistant',
        content: `I encountered an error while searching: ${error}. Please try again.`,
        timestamp: Date.now(),
      });
    } finally {
      this.isProcessing = false;
      this.view.setConnectionStatus('ready');
      this.renderMessages();
    }
  }

  setScope(scope: ContextScope): void {
    this.currentScope = scope;
    if (this.scopeDropdown) {
      this.scopeDropdown.value = scope;
    }
  }

  focusInput(): void {
    this.inputEl?.focus();
  }
}
