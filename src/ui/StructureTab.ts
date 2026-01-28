import { Notice, TFolder, TFile } from 'obsidian';
import type VaultAIPlugin from '../main';
import type { VaultAIView } from './SidebarView';
import {
  StructureSuggestion,
  StructureAnalysisResult,
  LLMMessage,
  UndoableOperation,
} from '../types';
import { FileOperations } from '../operations/FileOperations';
import { STRUCTURE_SYSTEM_PROMPT, buildStructurePrompt } from '../prompts/structure';

export class StructureTab {
  private plugin: VaultAIPlugin;
  private view: VaultAIView;
  private containerEl: HTMLElement | null = null;
  private suggestionsEl: HTMLElement | null = null;
  private historyEl: HTMLElement | null = null;
  private selectedFolder: string = '/';
  private suggestions: StructureSuggestion[] = [];
  private isAnalyzing = false;
  private fileOps: FileOperations;

  constructor(plugin: VaultAIPlugin, view: VaultAIView) {
    this.plugin = plugin;
    this.view = view;
    this.fileOps = new FileOperations(plugin.app);
  }

  render(container: HTMLElement): void {
    this.containerEl = container;
    container.addClass('vault-ai-structure-tab');

    // Scope selector
    const scopeContainer = container.createDiv('vault-ai-scope-container');
    scopeContainer.createSpan({ text: 'Analyze: ' });

    const folderSelect = scopeContainer.createEl('select', {
      cls: 'vault-ai-folder-select',
    });

    // Add "Entire Vault" option
    folderSelect.createEl('option', {
      text: 'Entire Vault',
      value: '/',
    });

    // Add all folders
    const folders = this.getAllFolders();
    for (const folder of folders) {
      folderSelect.createEl('option', {
        text: folder,
        value: folder,
      });
    }

    folderSelect.value = this.selectedFolder;
    folderSelect.addEventListener('change', () => {
      this.selectedFolder = folderSelect.value;
    });

    // Analyze button
    const analyzeBtn = container.createEl('button', {
      text: 'Analyze Structure',
      cls: 'vault-ai-analyze-button mod-cta',
    });

    analyzeBtn.addEventListener('click', () => {
      this.analyzeStructure();
    });

    // Suggestions container
    this.suggestionsEl = container.createDiv('vault-ai-suggestions');
    this.renderSuggestions();

    // Operation history
    const historySection = container.createDiv('vault-ai-history-section');
    const historyHeader = historySection.createDiv('vault-ai-history-header');
    historyHeader.createEl('h5', { text: 'Operation History' });

    const undoBtn = historyHeader.createEl('button', {
      text: 'Undo Last',
      cls: 'vault-ai-undo-button',
    });

    undoBtn.addEventListener('click', () => {
      this.undoLast();
    });

    this.historyEl = historySection.createDiv('vault-ai-history');
    this.renderHistory();
  }

  private getAllFolders(): string[] {
    const folders: string[] = [];
    const rootFolder = this.plugin.app.vault.getRoot();

    const traverse = (folder: TFolder, path: string) => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          const fullPath = path ? `${path}/${child.name}` : child.name;
          folders.push(fullPath);
          traverse(child, fullPath);
        }
      }
    };

    traverse(rootFolder, '');
    return folders.sort();
  }

  private renderSuggestions(): void {
    if (!this.suggestionsEl) return;
    this.suggestionsEl.empty();

    if (this.isAnalyzing) {
      this.suggestionsEl.createDiv('vault-ai-loading').createEl('p', {
        text: 'Analyzing vault structure...',
      });
      return;
    }

    if (this.suggestions.length === 0) {
      this.suggestionsEl.createDiv('vault-ai-empty-state').createEl('p', {
        text: 'Click "Analyze Structure" to get reorganization suggestions.',
      });
      return;
    }

    // Execute All button
    const actionsBar = this.suggestionsEl.createDiv('vault-ai-suggestions-actions');
    const executeAllBtn = actionsBar.createEl('button', {
      text: 'Execute All',
      cls: 'vault-ai-execute-all-button',
    });

    executeAllBtn.addEventListener('click', () => {
      this.executeAllSuggestions();
    });

    actionsBar.createSpan({
      text: `${this.suggestions.filter((s) => !s.executed).length} suggestions remaining`,
      cls: 'vault-ai-suggestions-count',
    });

    // Individual suggestions
    for (const suggestion of this.suggestions) {
      this.renderSuggestion(suggestion);
    }
  }

  private renderSuggestion(suggestion: StructureSuggestion): void {
    if (!this.suggestionsEl) return;

    const suggestionEl = this.suggestionsEl.createDiv(
      `vault-ai-suggestion ${suggestion.executed ? 'executed' : ''}`
    );

    const headerEl = suggestionEl.createDiv('vault-ai-suggestion-header');

    const typeIcon = this.getTypeIcon(suggestion.type);
    headerEl.createSpan({
      text: typeIcon,
      cls: 'vault-ai-type-icon',
    });

    headerEl.createSpan({ text: suggestion.description });

    if (suggestion.executed) {
      headerEl.createSpan({ text: '✓ Executed', cls: 'vault-ai-executed-badge' });
    }

    // Affected files count
    const metaEl = suggestionEl.createDiv('vault-ai-suggestion-meta');
    metaEl.createSpan({
      text: `${suggestion.affectedFiles.length} file(s) affected`,
      cls: 'vault-ai-affected-count',
    });

    // Reasoning
    if (suggestion.reasoning) {
      metaEl.createEl('p', {
        text: suggestion.reasoning,
        cls: 'vault-ai-reasoning',
      });
    }

    const actionsEl = suggestionEl.createDiv('vault-ai-suggestion-actions');

    if (!suggestion.executed) {
      const previewBtn = actionsEl.createEl('button', {
        text: 'Preview',
        cls: 'vault-ai-preview-button',
      });

      previewBtn.addEventListener('click', () => {
        this.previewSuggestion(suggestion);
      });

      const executeBtn = actionsEl.createEl('button', {
        text: 'Execute',
        cls: 'vault-ai-execute-button',
      });

      executeBtn.addEventListener('click', () => {
        this.executeSuggestion(suggestion);
      });
    }
  }

  private getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      'create-folder': '📁',
      move: '➡️',
      rename: '✏️',
      merge: '🔗',
      tag: '🏷️',
      archive: '📦',
    };
    return icons[type] || '📄';
  }

  private renderHistory(): void {
    if (!this.historyEl) return;
    this.historyEl.empty();

    const history = this.plugin.undoStack.getHistory();

    if (history.length === 0) {
      this.historyEl.createEl('p', {
        text: 'No operations yet.',
        cls: 'vault-ai-empty-history',
      });
      return;
    }

    for (const op of history.slice().reverse()) {
      const opEl = this.historyEl.createDiv('vault-ai-history-item');
      const date = new Date(op.timestamp);
      const timeStr = date.toLocaleTimeString();

      opEl.createSpan({ text: timeStr, cls: 'vault-ai-history-time' });
      opEl.createSpan({ text: op.description });
    }
  }

  async analyzeStructure(): Promise<void> {
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
      // Get file structure info
      const fileInfo = this.getFileStructureInfo();

      const messages: LLMMessage[] = [
        { role: 'system', content: STRUCTURE_SYSTEM_PROMPT },
        { role: 'user', content: buildStructurePrompt(fileInfo, this.selectedFolder) },
      ];

      const response = await this.plugin.llmClient?.chat(messages);

      if (response) {
        const result = this.parseStructureResponse(response);
        this.suggestions = result.suggestions;
      }
    } catch (error) {
      console.error('Structure analysis error:', error);
      new Notice(`Analysis failed: ${error}`);
    } finally {
      this.isAnalyzing = false;
      this.view.setConnectionStatus('ready');
      this.renderSuggestions();
    }
  }

  private getFileStructureInfo(): string {
    const files = this.plugin.app.vault.getMarkdownFiles();
    const basePath = this.selectedFolder === '/' ? '' : this.selectedFolder;

    const relevantFiles = files.filter((f) => {
      if (basePath === '') return true;
      return f.path.startsWith(basePath);
    });

    const fileList = relevantFiles.map((f) => {
      const cache = this.plugin.app.metadataCache.getFileCache(f);
      const tags = cache?.tags?.map((t) => t.tag).join(', ') || '';
      const frontmatterTags = cache?.frontmatter?.tags || [];
      const allTags = tags || (Array.isArray(frontmatterTags) ? frontmatterTags.join(', ') : frontmatterTags);

      return `- ${f.path}${allTags ? ` [tags: ${allTags}]` : ''}`;
    });

    return fileList.join('\n');
  }

  private parseStructureResponse(response: string): StructureAnalysisResult {
    try {
      const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;

      const data = JSON.parse(jsonStr);

      if (Array.isArray(data)) {
        return {
          suggestions: data.map((s, i) => ({
            id: `structure-${i}`,
            type: s.type || 'move',
            description: s.description || 'Reorganization',
            reasoning: s.reasoning || '',
            affectedFiles: s.affectedFiles || [],
            operations: s.operations || [],
            executed: false,
          })),
          summary: '',
        };
      }

      return {
        suggestions: (data.suggestions || []).map((s: any, i: number) => ({
          id: `structure-${i}`,
          type: s.type || 'move',
          description: s.description || 'Reorganization',
          reasoning: s.reasoning || '',
          affectedFiles: s.affectedFiles || [],
          operations: s.operations || [],
          executed: false,
        })),
        summary: data.summary || '',
      };
    } catch (error) {
      console.error('Failed to parse structure response:', error);
      return { suggestions: [], summary: '' };
    }
  }

  private previewSuggestion(suggestion: StructureSuggestion): void {
    const modal = this.plugin.app.workspace.containerEl.createDiv('modal-container');
    modal.addClass('vault-ai-preview-modal');

    const content = modal.createDiv('modal-content');
    content.createEl('h3', { text: 'Preview: ' + suggestion.description });

    const fileList = content.createEl('ul');
    for (const file of suggestion.affectedFiles) {
      fileList.createEl('li', { text: file });
    }

    const opList = content.createDiv('vault-ai-operations-list');
    opList.createEl('h4', { text: 'Operations:' });

    for (const op of suggestion.operations) {
      const opEl = opList.createEl('p');
      opEl.createSpan({ text: `${op.type}: `, cls: 'op-type' });
      opEl.createSpan({ text: op.sourcePath });
      if (op.targetPath) {
        opEl.createSpan({ text: ' → ' });
        opEl.createSpan({ text: op.targetPath });
      }
    }

    const buttonRow = content.createDiv('vault-ai-modal-buttons');

    const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => modal.remove());

    const executeBtn = buttonRow.createEl('button', {
      text: 'Execute',
      cls: 'mod-cta',
    });
    executeBtn.addEventListener('click', async () => {
      modal.remove();
      await this.executeSuggestion(suggestion);
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  private async executeSuggestion(suggestion: StructureSuggestion): Promise<void> {
    try {
      const undoOp = await this.fileOps.executeOperations(
        suggestion.operations,
        suggestion.description
      );

      if (undoOp) {
        this.plugin.undoStack.push(undoOp);
      }

      suggestion.executed = true;
      new Notice(`Executed: ${suggestion.description}`);

      this.renderSuggestions();
      this.renderHistory();
    } catch (error) {
      console.error('Failed to execute suggestion:', error);
      new Notice(`Failed: ${error}`);
    }
  }

  private async executeAllSuggestions(): Promise<void> {
    const pending = this.suggestions.filter((s) => !s.executed);

    for (const suggestion of pending) {
      await this.executeSuggestion(suggestion);
    }

    new Notice(`Executed ${pending.length} suggestion(s)`);
  }

  private async undoLast(): Promise<void> {
    const undone = await this.plugin.undoStack.undo(this.plugin.app);

    if (undone) {
      new Notice(`Undone: ${undone.description}`);
      this.renderHistory();
    } else {
      new Notice('Nothing to undo');
    }
  }
}
