import { MarkdownView, Notice, TFile } from 'obsidian';
import type VaultAIPlugin from '../main';
import type { VaultAIView } from './SidebarView';
import { FormatSuggestion, FormatAnalysisResult, LLMMessage } from '../types';
import { FORMAT_SYSTEM_PROMPT, buildFormatPrompt } from '../prompts/format';

/**
 * Represents a diff operation type
 */
type DiffType = 'equal' | 'insert' | 'delete';

/**
 * Represents a single diff chunk at the line level
 */
interface LineDiff {
  type: DiffType;
  oldLine?: number;
  newLine?: number;
  oldText?: string;
  newText?: string;
  charDiffs?: CharDiff[];
}

/**
 * Represents character-level differences within a line
 */
interface CharDiff {
  type: DiffType;
  text: string;
}

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

    headerEl.createSpan({
      text: suggestion.category,
      cls: `vault-ai-category-badge category-${suggestion.category}`,
    });

    headerEl.createSpan({ text: suggestion.description, cls: 'vault-ai-suggestion-description' });

    if (suggestion.applied) {
      headerEl.createSpan({ text: '✓ Applied', cls: 'vault-ai-applied-badge' });
    }

    if (!suggestion.applied) {
      // Embedded unified diff view
      const diffContainer = suggestionEl.createDiv('vault-ai-embedded-diff');
      this.renderEmbeddedDiff(diffContainer, suggestion.before, suggestion.after);

      // Accept/Decline buttons
      const actionsEl = suggestionEl.createDiv('vault-ai-suggestion-actions');

      const declineBtn = actionsEl.createEl('button', {
        text: 'Decline',
        cls: 'vault-ai-decline-button',
      });

      declineBtn.addEventListener('click', () => {
        this.declineSuggestion(suggestion);
      });

      const acceptBtn = actionsEl.createEl('button', {
        text: 'Accept',
        cls: 'vault-ai-accept-button',
      });

      acceptBtn.addEventListener('click', () => {
        this.applySuggestion(suggestion);
      });
    }
  }

  private renderEmbeddedDiff(container: HTMLElement, before: string, after: string): void {
    const lineDiffs = this.computeDiff(before, after);
    const content = container.createDiv('vault-ai-embedded-diff-content');

    for (const diff of lineDiffs) {
      if (diff.type === 'equal') {
        this.renderUnifiedLine(content, ' ', diff.oldLine!, diff.newLine!, diff.oldText!, 'unchanged');
      } else if (diff.type === 'delete') {
        this.renderUnifiedLine(content, '-', diff.oldLine!, undefined, diff.oldText!, 'removed');
      } else if (diff.type === 'insert') {
        this.renderUnifiedLine(content, '+', undefined, diff.newLine!, diff.newText!, 'added');
      } else if (diff.charDiffs) {
        // Modified: show delete then insert with char diffs
        this.renderUnifiedLineWithCharDiffs(content, '-', diff.oldLine!, undefined, diff.oldText!, diff.charDiffs, 'removed');
        this.renderUnifiedLineWithCharDiffs(content, '+', undefined, diff.newLine!, diff.newText!, diff.charDiffs, 'added');
      }
    }
  }

  private renderUnifiedLine(
    container: HTMLElement,
    prefix: string,
    oldLineNum: number | undefined,
    newLineNum: number | undefined,
    text: string,
    type: 'unchanged' | 'added' | 'removed'
  ): void {
    const lineEl = container.createDiv(`vault-ai-diff-line ${type}`);

    lineEl.createSpan({ text: prefix, cls: 'line-prefix' });

    const contentEl = lineEl.createSpan({ cls: 'line-content' });
    contentEl.textContent = text || ' ';
  }

  private renderUnifiedLineWithCharDiffs(
    container: HTMLElement,
    prefix: string,
    oldLineNum: number | undefined,
    newLineNum: number | undefined,
    text: string,
    charDiffs: CharDiff[],
    type: 'added' | 'removed'
  ): void {
    const lineEl = container.createDiv(`vault-ai-diff-line modified ${type}`);

    lineEl.createSpan({ text: prefix, cls: 'line-prefix' });

    const contentEl = lineEl.createSpan({ cls: 'line-content' });

    for (const charDiff of charDiffs) {
      if (charDiff.type === 'equal') {
        contentEl.createSpan({ text: charDiff.text });
      } else if (charDiff.type === 'delete' && type === 'removed') {
        contentEl.createSpan({ text: charDiff.text, cls: 'char-removed' });
      } else if (charDiff.type === 'insert' && type === 'added') {
        contentEl.createSpan({ text: charDiff.text, cls: 'char-added' });
      }
    }

    if (!contentEl.textContent) {
      contentEl.textContent = ' ';
    }
  }

  /**
   * Compute line-level diff using LCS approach
   */
  private computeDiff(before: string, after: string): LineDiff[] {
    const oldLines = before.split('\n');
    const newLines = after.split('\n');

    const diffs: LineDiff[] = [];
    const lcs = this.longestCommonSubsequence(oldLines, newLines);

    let oldIdx = 0;
    let newIdx = 0;
    let lcsIdx = 0;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (lcsIdx < lcs.length && oldIdx < oldLines.length && newIdx < newLines.length &&
          oldLines[oldIdx] === lcs[lcsIdx] && newLines[newIdx] === lcs[lcsIdx]) {
        diffs.push({
          type: 'equal',
          oldLine: oldIdx + 1,
          newLine: newIdx + 1,
          oldText: oldLines[oldIdx],
          newText: newLines[newIdx],
        });
        oldIdx++;
        newIdx++;
        lcsIdx++;
      } else if (oldIdx < oldLines.length && (lcsIdx >= lcs.length || oldLines[oldIdx] !== lcs[lcsIdx])) {
        if (newIdx < newLines.length && (lcsIdx >= lcs.length || newLines[newIdx] !== lcs[lcsIdx])) {
          const similarity = this.getSimilarity(oldLines[oldIdx], newLines[newIdx]);

          if (similarity > 0.4) {
            const charDiffs = this.computeCharDiff(oldLines[oldIdx], newLines[newIdx]);
            diffs.push({
              type: 'equal',
              oldLine: oldIdx + 1,
              newLine: newIdx + 1,
              oldText: oldLines[oldIdx],
              newText: newLines[newIdx],
              charDiffs,
            });
            oldIdx++;
            newIdx++;
          } else {
            diffs.push({
              type: 'delete',
              oldLine: oldIdx + 1,
              oldText: oldLines[oldIdx],
            });
            oldIdx++;
          }
        } else {
          diffs.push({
            type: 'delete',
            oldLine: oldIdx + 1,
            oldText: oldLines[oldIdx],
          });
          oldIdx++;
        }
      } else if (newIdx < newLines.length) {
        diffs.push({
          type: 'insert',
          newLine: newIdx + 1,
          newText: newLines[newIdx],
        });
        newIdx++;
      }
    }

    return diffs;
  }

  private longestCommonSubsequence(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;
    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const lcs: string[] = [];
    let i = m;
    let j = n;

    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        lcs.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return lcs;
  }

  private computeCharDiff(oldText: string, newText: string): CharDiff[] {
    const diffs: CharDiff[] = [];
    const oldWords = this.tokenize(oldText);
    const newWords = this.tokenize(newText);
    const lcs = this.longestCommonSubsequence(oldWords, newWords);

    let oldIdx = 0;
    let newIdx = 0;
    let lcsIdx = 0;

    while (oldIdx < oldWords.length || newIdx < newWords.length) {
      if (lcsIdx < lcs.length && oldIdx < oldWords.length && newIdx < newWords.length &&
          oldWords[oldIdx] === lcs[lcsIdx] && newWords[newIdx] === lcs[lcsIdx]) {
        diffs.push({ type: 'equal', text: oldWords[oldIdx] });
        oldIdx++;
        newIdx++;
        lcsIdx++;
      } else if (oldIdx < oldWords.length && (lcsIdx >= lcs.length || oldWords[oldIdx] !== lcs[lcsIdx])) {
        diffs.push({ type: 'delete', text: oldWords[oldIdx] });
        oldIdx++;
      } else if (newIdx < newWords.length) {
        diffs.push({ type: 'insert', text: newWords[newIdx] });
        newIdx++;
      }
    }

    return diffs;
  }

  private tokenize(text: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inWord = false;

    for (const char of text) {
      const isWordChar = /\S/.test(char);

      if (isWordChar !== inWord) {
        if (current) {
          tokens.push(current);
        }
        current = char;
        inWord = isWordChar;
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  private getSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;

    const editDistance = this.levenshteinDistance(shorter, longer);
    return (longer.length - editDistance) / longer.length;
  }

  private levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  }

  private declineSuggestion(suggestion: FormatSuggestion): void {
    const index = this.suggestions.indexOf(suggestion);
    if (index > -1) {
      this.suggestions.splice(index, 1);
      this.renderSuggestions();
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
