import { App, Modal } from 'obsidian';

export class DiffModal extends Modal {
  private before: string;
  private after: string;
  private title: string;
  private onApply: () => void;

  constructor(
    app: App,
    before: string,
    after: string,
    title: string,
    onApply: () => void
  ) {
    super(app);
    this.before = before;
    this.after = after;
    this.title = title;
    this.onApply = onApply;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('vault-ai-diff-modal');

    contentEl.createEl('h2', { text: this.title });

    // Diff view container
    const diffContainer = contentEl.createDiv('vault-ai-diff-container');

    // Before column
    const beforeCol = diffContainer.createDiv('vault-ai-diff-column');
    beforeCol.createEl('h4', { text: 'Before' });
    const beforeContent = beforeCol.createDiv('vault-ai-diff-content before');
    this.renderDiffContent(beforeContent, this.before, 'removed');

    // After column
    const afterCol = diffContainer.createDiv('vault-ai-diff-column');
    afterCol.createEl('h4', { text: 'After' });
    const afterContent = afterCol.createDiv('vault-ai-diff-content after');
    this.renderDiffContent(afterContent, this.after, 'added');

    // Unified diff view toggle
    const viewToggle = contentEl.createDiv('vault-ai-diff-toggle');
    const unifiedBtn = viewToggle.createEl('button', { text: 'Unified View' });
    const sideBySideBtn = viewToggle.createEl('button', {
      text: 'Side by Side',
      cls: 'active',
    });

    unifiedBtn.addEventListener('click', () => {
      diffContainer.addClass('unified');
      unifiedBtn.addClass('active');
      sideBySideBtn.removeClass('active');
    });

    sideBySideBtn.addEventListener('click', () => {
      diffContainer.removeClass('unified');
      sideBySideBtn.addClass('active');
      unifiedBtn.removeClass('active');
    });

    // Action buttons
    const buttonRow = contentEl.createDiv('vault-ai-diff-buttons');

    const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const applyBtn = buttonRow.createEl('button', {
      text: 'Apply',
      cls: 'mod-cta',
    });
    applyBtn.addEventListener('click', () => {
      this.onApply();
      this.close();
    });
  }

  private renderDiffContent(
    container: HTMLElement,
    content: string,
    type: 'added' | 'removed'
  ): void {
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineEl = container.createDiv('vault-ai-diff-line');
      lineEl.createSpan({ text: String(i + 1), cls: 'line-number' });

      const lineContent = lineEl.createSpan({ cls: `line-content ${type}` });
      lineContent.textContent = lines[i] || ' ';
    }
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
