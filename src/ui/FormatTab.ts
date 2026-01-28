import { MarkdownView, Notice, TFile } from 'obsidian';
import type VaultAIPlugin from '../main';
import type { VaultAIView } from './SidebarView';
import { FormatSuggestion, FormatAnalysisResult, LLMMessage } from '../types';
import { DiffModal } from './DiffModal';
import { FORMAT_SYSTEM_PROMPT, buildFormatPrompt } from '../prompts/format';

export class FormatTab {
  private plugin: VaultAIPlugin;
  private view: VaultAIView;
  private containerEl: HTMLElement | null = null;
  private suggestionsEl: HTMLElement | null = null;
  private customInstructionsEl: HTMLTextAreaElement | null = null;
  private suggestions: FormatSuggestion[] = [];
  private isAnalyzing = false;
  private currentFileContent: string = '';
  private currentFilePath: string = '';

  constructor(plugin: VaultAIPlugin, view: VaultAIView) {
    this.plugin = plugin;
    this.view = view;
  }

  render(container: HTMLElement): void {
    this.containerEl = container;
    container.addClass('vault-ai-format-tab');

    // Current file info
    const fileInfo = container.createDiv('vault-ai-file-info');
    const currentFile = this.plugin.app.workspace.getActiveFile();

    if (currentFile) {
      fileInfo.createEl('p', { text: `Current: ${currentFile.name}` });
    } else {
      fileInfo.createEl('p', {
        text: 'No file open. Open a note to format it.',
        cls: 'vault-ai-warning',
      });
    }

    // Custom instructions
    const instructionsContainer = container.createDiv('vault-ai-instructions');
    instructionsContainer.createEl('label', { text: 'Custom instructions (optional):' });

    this.customInstructionsEl = instructionsContainer.createEl('textarea', {
      cls: 'vault-ai-custom-instructions',
      attr: {
        placeholder:
          'e.g., "Focus on heading structure" or "Add frontmatter with tags"',
        rows: '2',
      },
    });

    // Analyze button
    const analyzeBtn = container.createEl('button', {
      text: 'Analyze Current Note',
      cls: 'vault-ai-analyze-button mod-cta',
    });

    analyzeBtn.addEventListener('click', () => {
      this.analyzeCurrentNote();
    });

    // Suggestions container
    this.suggestionsEl = container.createDiv('vault-ai-suggestions');
    this.renderSuggestions();
  }

  private renderSuggestions(): void {
    if (!this.suggestionsEl) return;
    this.suggestionsEl.empty();

    if (this.isAnalyzing) {
      this.suggestionsEl.createDiv('vault-ai-loading').createEl('p', {
        text: 'Analyzing note formatting...',
      });
      return;
    }

    if (this.suggestions.length === 0) {
      this.suggestionsEl.createDiv('vault-ai-empty-state').createEl('p', {
        text: 'Click "Analyze Current Note" to get formatting suggestions.',
      });
      return;
    }

    // Apply All button
    const actionsBar = this.suggestionsEl.createDiv('vault-ai-suggestions-actions');
    const applyAllBtn = actionsBar.createEl('button', {
      text: 'Apply All',
      cls: 'vault-ai-apply-all-button',
    });

    applyAllBtn.addEventListener('click', () => {
      this.applyAllSuggestions();
    });

    actionsBar.createSpan({
      text: `${this.suggestions.filter((s) => !s.applied).length} suggestions remaining`,
      cls: 'vault-ai-suggestions-count',
    });

    // Individual suggestions
    for (const suggestion of this.suggestions) {
      this.renderSuggestion(suggestion);
    }
  }

  private renderSuggestion(suggestion: FormatSuggestion): void {
    if (!this.suggestionsEl) return;

    const suggestionEl = this.suggestionsEl.createDiv(
      `vault-ai-suggestion ${suggestion.applied ? 'applied' : ''}`
    );

    const headerEl = suggestionEl.createDiv('vault-ai-suggestion-header');

    const categoryBadge = headerEl.createSpan({
      text: suggestion.category,
      cls: `vault-ai-category-badge category-${suggestion.category}`,
    });

    headerEl.createSpan({ text: suggestion.description });

    if (suggestion.applied) {
      headerEl.createSpan({ text: '✓ Applied', cls: 'vault-ai-applied-badge' });
    }

    const actionsEl = suggestionEl.createDiv('vault-ai-suggestion-actions');

    if (!suggestion.applied) {
      const previewBtn = actionsEl.createEl('button', {
        text: 'Preview',
        cls: 'vault-ai-preview-button',
      });

      previewBtn.addEventListener('click', () => {
        this.previewSuggestion(suggestion);
      });

      const applyBtn = actionsEl.createEl('button', {
        text: 'Apply',
        cls: 'vault-ai-apply-button',
      });

      applyBtn.addEventListener('click', () => {
        this.applySuggestion(suggestion);
      });
    }
  }

  async analyzeCurrentNote(): Promise<void> {
    const activeFile = this.plugin.app.workspace.getActiveFile();

    if (!activeFile) {
      new Notice('No file is currently open.');
      return;
    }

    if (this.plugin.connectionStatus === 'offline') {
      new Notice('Not connected to LLM server.');
      return;
    }

    if (!this.plugin.settings.selectedModel) {
      new Notice('No model selected. Please select a model in settings.');
      return;
    }

    this.isAnalyzing = true;
    this.suggestions = [];
    this.view.setConnectionStatus('thinking');
    this.renderSuggestions();

    try {
      // Read current file content
      this.currentFileContent = await this.plugin.app.vault.read(activeFile);
      this.currentFilePath = activeFile.path;

      const customInstructions = this.customInstructionsEl?.value || '';

      const messages: LLMMessage[] = [
        { role: 'system', content: FORMAT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildFormatPrompt(this.currentFileContent, customInstructions),
        },
      ];

      const response = await this.plugin.llmClient?.chat(messages);

      if (response) {
        const result = this.parseFormatResponse(response);
        this.suggestions = result.suggestions;
      }
    } catch (error) {
      console.error('Format analysis error:', error);
      new Notice(`Analysis failed: ${error}`);
    } finally {
      this.isAnalyzing = false;
      this.view.setConnectionStatus('ready');
      this.renderSuggestions();
    }
  }

  private parseFormatResponse(response: string): FormatAnalysisResult {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;

      const data = JSON.parse(jsonStr);

      if (Array.isArray(data)) {
        return {
          suggestions: data.map((s, i) => ({
            id: `suggestion-${i}`,
            description: s.description || 'Formatting improvement',
            category: s.category || 'other',
            before: s.before || '',
            after: s.after || '',
            lineStart: s.lineStart || 0,
            lineEnd: s.lineEnd || 0,
            applied: false,
          })),
          summary: '',
        };
      }

      return {
        suggestions: (data.suggestions || []).map((s: any, i: number) => ({
          id: `suggestion-${i}`,
          description: s.description || 'Formatting improvement',
          category: s.category || 'other',
          before: s.before || '',
          after: s.after || '',
          lineStart: s.lineStart || 0,
          lineEnd: s.lineEnd || 0,
          applied: false,
        })),
        summary: data.summary || '',
      };
    } catch (error) {
      console.error('Failed to parse format response:', error);
      return { suggestions: [], summary: '' };
    }
  }

  private previewSuggestion(suggestion: FormatSuggestion): void {
    const modal = new DiffModal(
      this.plugin.app,
      suggestion.before,
      suggestion.after,
      suggestion.description,
      () => this.applySuggestion(suggestion)
    );
    modal.open();
  }

  private async applySuggestion(suggestion: FormatSuggestion): Promise<void> {
    const activeFile = this.plugin.app.workspace.getActiveFile();

    if (!activeFile || activeFile.path !== this.currentFilePath) {
      new Notice('The original file is no longer open.');
      return;
    }

    try {
      // Get current content
      let content = await this.plugin.app.vault.read(activeFile);

      // Replace the old text with new text
      if (suggestion.before && suggestion.after !== undefined) {
        content = content.replace(suggestion.before, suggestion.after);
        await this.plugin.app.vault.modify(activeFile, content);

        suggestion.applied = true;
        this.currentFileContent = content;

        new Notice('Suggestion applied');
        this.renderSuggestions();
      }
    } catch (error) {
      console.error('Failed to apply suggestion:', error);
      new Notice(`Failed to apply: ${error}`);
    }
  }

  private async applyAllSuggestions(): Promise<void> {
    const pending = this.suggestions.filter((s) => !s.applied);

    for (const suggestion of pending) {
      await this.applySuggestion(suggestion);
    }

    new Notice(`Applied ${pending.length} suggestion(s)`);
  }
}
