import { App, Modal } from 'obsidian';

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

/**
 * Enhanced Diff Modal with VS Code-like visual diff checking
 */
export class DiffModal extends Modal {
  private before: string;
  private after: string;
  private title: string;
  private onApply: () => void;
  private lineDiffs: LineDiff[] = [];
  private viewMode: 'side-by-side' | 'unified' = 'side-by-side';

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
    this.lineDiffs = this.computeDiff(before, after);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass('vault-ai-diff-modal');
    contentEl.empty();

    // Header with title and stats
    const header = contentEl.createDiv('vault-ai-diff-header');
    header.createEl('h2', { text: this.title });

    const stats = this.getChangeStats();
    const statsEl = header.createDiv('vault-ai-diff-stats');
    if (stats.added > 0) {
      statsEl.createSpan({ text: `+${stats.added}`, cls: 'stat-added' });
    }
    if (stats.removed > 0) {
      statsEl.createSpan({ text: `-${stats.removed}`, cls: 'stat-removed' });
    }
    if (stats.modified > 0) {
      statsEl.createSpan({ text: `~${stats.modified}`, cls: 'stat-modified' });
    }

    // View toggle buttons
    const viewToggle = contentEl.createDiv('vault-ai-diff-toggle');
    const sideBySideBtn = viewToggle.createEl('button', {
      text: 'Side by Side',
      cls: 'active',
    });
    const unifiedBtn = viewToggle.createEl('button', { text: 'Unified' });
    const inlineBtn = viewToggle.createEl('button', { text: 'Inline' });

    // Diff container
    const diffContainer = contentEl.createDiv('vault-ai-diff-container');

    // Render initial view
    this.renderSideBySide(diffContainer);

    // View toggle handlers
    sideBySideBtn.addEventListener('click', () => {
      this.setActiveButton([sideBySideBtn, unifiedBtn, inlineBtn], sideBySideBtn);
      this.viewMode = 'side-by-side';
      diffContainer.empty();
      this.renderSideBySide(diffContainer);
    });

    unifiedBtn.addEventListener('click', () => {
      this.setActiveButton([sideBySideBtn, unifiedBtn, inlineBtn], unifiedBtn);
      this.viewMode = 'unified';
      diffContainer.empty();
      this.renderUnified(diffContainer);
    });

    inlineBtn.addEventListener('click', () => {
      this.setActiveButton([sideBySideBtn, unifiedBtn, inlineBtn], inlineBtn);
      diffContainer.empty();
      this.renderInline(diffContainer);
    });

    // Action buttons
    const buttonRow = contentEl.createDiv('vault-ai-diff-buttons');

    const cancelBtn = buttonRow.createEl('button', { text: 'Cancel' });
    cancelBtn.addEventListener('click', () => this.close());

    const applyBtn = buttonRow.createEl('button', {
      text: 'Apply Changes',
      cls: 'mod-cta',
    });
    applyBtn.addEventListener('click', () => {
      this.onApply();
      this.close();
    });
  }

  private setActiveButton(buttons: HTMLButtonElement[], active: HTMLButtonElement): void {
    buttons.forEach(btn => btn.removeClass('active'));
    active.addClass('active');
  }

  /**
   * Render side-by-side diff view (VS Code style)
   */
  private renderSideBySide(container: HTMLElement): void {
    container.addClass('side-by-side');
    container.removeClass('unified');

    // Left panel (before/original)
    const leftPanel = container.createDiv('vault-ai-diff-panel left');
    const leftHeader = leftPanel.createDiv('panel-header');
    leftHeader.createSpan({ text: 'Original', cls: 'panel-title' });
    const leftContent = leftPanel.createDiv('vault-ai-diff-content');

    // Right panel (after/modified)
    const rightPanel = container.createDiv('vault-ai-diff-panel right');
    const rightHeader = rightPanel.createDiv('panel-header');
    rightHeader.createSpan({ text: 'Modified', cls: 'panel-title' });
    const rightContent = rightPanel.createDiv('vault-ai-diff-content');

    // Render diff lines
    for (const diff of this.lineDiffs) {
      if (diff.type === 'equal') {
        // Unchanged line - show on both sides
        this.renderLine(leftContent, diff.oldLine!, diff.oldText!, 'unchanged');
        this.renderLine(rightContent, diff.newLine!, diff.newText!, 'unchanged');
      } else if (diff.type === 'delete') {
        // Deleted line - show on left, empty on right
        this.renderLine(leftContent, diff.oldLine!, diff.oldText!, 'removed');
        this.renderEmptyLine(rightContent);
      } else if (diff.type === 'insert') {
        // Inserted line - empty on left, show on right
        this.renderEmptyLine(leftContent);
        this.renderLine(rightContent, diff.newLine!, diff.newText!, 'added');
      } else if (diff.charDiffs) {
        // Modified line - show both with character-level highlighting
        this.renderLineWithCharDiffs(leftContent, diff.oldLine!, diff.oldText!, diff.charDiffs, 'removed');
        this.renderLineWithCharDiffs(rightContent, diff.newLine!, diff.newText!, diff.charDiffs, 'added');
      }
    }

    // Synchronized scrolling
    this.setupSyncScroll(leftContent, rightContent);
  }

  /**
   * Render unified diff view (like git diff)
   */
  private renderUnified(container: HTMLElement): void {
    container.removeClass('side-by-side');
    container.addClass('unified');

    const panel = container.createDiv('vault-ai-diff-panel unified-panel');
    const header = panel.createDiv('panel-header');
    header.createSpan({ text: 'Unified Diff', cls: 'panel-title' });
    const content = panel.createDiv('vault-ai-diff-content');

    for (const diff of this.lineDiffs) {
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

  /**
   * Render inline diff view (changes highlighted within the same line)
   */
  private renderInline(container: HTMLElement): void {
    container.removeClass('side-by-side');
    container.addClass('unified');

    const panel = container.createDiv('vault-ai-diff-panel unified-panel');
    const header = panel.createDiv('panel-header');
    header.createSpan({ text: 'Inline Changes', cls: 'panel-title' });
    const content = panel.createDiv('vault-ai-diff-content');

    for (const diff of this.lineDiffs) {
      if (diff.type === 'equal') {
        this.renderLine(content, diff.oldLine!, diff.oldText!, 'unchanged');
      } else if (diff.type === 'delete') {
        this.renderLine(content, diff.oldLine!, diff.oldText!, 'removed', '-');
      } else if (diff.type === 'insert') {
        this.renderLine(content, diff.newLine!, diff.newText!, 'added', '+');
      } else if (diff.charDiffs) {
        // Modified: render inline with both deletions and additions highlighted
        this.renderInlineModifiedLine(content, diff);
      }
    }
  }

  private renderLine(
    container: HTMLElement,
    lineNum: number,
    text: string,
    type: 'unchanged' | 'added' | 'removed',
    prefix?: string
  ): void {
    const lineEl = container.createDiv(`vault-ai-diff-line ${type}`);

    if (prefix) {
      lineEl.createSpan({ text: prefix, cls: 'line-prefix' });
    }

    lineEl.createSpan({ text: String(lineNum).padStart(4), cls: 'line-number' });

    const contentEl = lineEl.createSpan({ cls: 'line-content' });
    contentEl.textContent = text || ' ';
  }

  private renderEmptyLine(container: HTMLElement): void {
    const lineEl = container.createDiv('vault-ai-diff-line empty');
    lineEl.createSpan({ text: '    ', cls: 'line-number' });
    lineEl.createSpan({ text: ' ', cls: 'line-content' });
  }

  private renderLineWithCharDiffs(
    container: HTMLElement,
    lineNum: number,
    text: string,
    charDiffs: CharDiff[],
    side: 'added' | 'removed'
  ): void {
    const lineEl = container.createDiv(`vault-ai-diff-line modified ${side}`);
    lineEl.createSpan({ text: String(lineNum).padStart(4), cls: 'line-number' });

    const contentEl = lineEl.createSpan({ cls: 'line-content' });

    for (const charDiff of charDiffs) {
      if (charDiff.type === 'equal') {
        contentEl.createSpan({ text: charDiff.text });
      } else if (charDiff.type === 'delete' && side === 'removed') {
        contentEl.createSpan({ text: charDiff.text, cls: 'char-removed' });
      } else if (charDiff.type === 'insert' && side === 'added') {
        contentEl.createSpan({ text: charDiff.text, cls: 'char-added' });
      }
    }

    // If content is empty, add a space to maintain line height
    if (!contentEl.textContent) {
      contentEl.textContent = ' ';
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
    lineEl.createSpan({
      text: oldLineNum !== undefined ? String(oldLineNum).padStart(4) : '    ',
      cls: 'line-number old'
    });
    lineEl.createSpan({
      text: newLineNum !== undefined ? String(newLineNum).padStart(4) : '    ',
      cls: 'line-number new'
    });

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
    lineEl.createSpan({
      text: oldLineNum !== undefined ? String(oldLineNum).padStart(4) : '    ',
      cls: 'line-number old'
    });
    lineEl.createSpan({
      text: newLineNum !== undefined ? String(newLineNum).padStart(4) : '    ',
      cls: 'line-number new'
    });

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

  private renderInlineModifiedLine(container: HTMLElement, diff: LineDiff): void {
    const lineEl = container.createDiv('vault-ai-diff-line modified inline');

    lineEl.createSpan({ text: '~', cls: 'line-prefix' });
    lineEl.createSpan({ text: String(diff.oldLine!).padStart(4), cls: 'line-number' });

    const contentEl = lineEl.createSpan({ cls: 'line-content' });

    if (diff.charDiffs) {
      for (const charDiff of diff.charDiffs) {
        if (charDiff.type === 'equal') {
          contentEl.createSpan({ text: charDiff.text });
        } else if (charDiff.type === 'delete') {
          contentEl.createSpan({ text: charDiff.text, cls: 'char-removed inline' });
        } else if (charDiff.type === 'insert') {
          contentEl.createSpan({ text: charDiff.text, cls: 'char-added inline' });
        }
      }
    }

    if (!contentEl.textContent) {
      contentEl.textContent = ' ';
    }
  }

  private setupSyncScroll(left: HTMLElement, right: HTMLElement): void {
    let isSyncing = false;

    const syncScroll = (source: HTMLElement, target: HTMLElement) => {
      if (isSyncing) return;
      isSyncing = true;
      target.scrollTop = source.scrollTop;
      target.scrollLeft = source.scrollLeft;
      isSyncing = false;
    };

    left.addEventListener('scroll', () => syncScroll(left, right));
    right.addEventListener('scroll', () => syncScroll(right, left));
  }

  /**
   * Compute line-level diff using Myers' diff algorithm (simplified LCS approach)
   */
  private computeDiff(before: string, after: string): LineDiff[] {
    const oldLines = before.split('\n');
    const newLines = after.split('\n');

    const diffs: LineDiff[] = [];

    // Use LCS to find matching lines
    const lcs = this.longestCommonSubsequence(oldLines, newLines);

    let oldIdx = 0;
    let newIdx = 0;
    let lcsIdx = 0;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      if (lcsIdx < lcs.length && oldIdx < oldLines.length && newIdx < newLines.length &&
          oldLines[oldIdx] === lcs[lcsIdx] && newLines[newIdx] === lcs[lcsIdx]) {
        // Line exists in both - unchanged
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
        // Check if this is a modification (similar line exists in new at same position)
        if (newIdx < newLines.length && (lcsIdx >= lcs.length || newLines[newIdx] !== lcs[lcsIdx])) {
          // Both old and new have different lines here - might be a modification
          const similarity = this.getSimilarity(oldLines[oldIdx], newLines[newIdx]);

          if (similarity > 0.4) {
            // Lines are similar enough - treat as modification with char diff
            const charDiffs = this.computeCharDiff(oldLines[oldIdx], newLines[newIdx]);
            diffs.push({
              type: 'equal', // Using 'equal' with charDiffs to indicate modification
              oldLine: oldIdx + 1,
              newLine: newIdx + 1,
              oldText: oldLines[oldIdx],
              newText: newLines[newIdx],
              charDiffs,
            });
            oldIdx++;
            newIdx++;
          } else {
            // Lines are too different - treat as delete
            diffs.push({
              type: 'delete',
              oldLine: oldIdx + 1,
              oldText: oldLines[oldIdx],
            });
            oldIdx++;
          }
        } else {
          // Line only in old - deleted
          diffs.push({
            type: 'delete',
            oldLine: oldIdx + 1,
            oldText: oldLines[oldIdx],
          });
          oldIdx++;
        }
      } else if (newIdx < newLines.length) {
        // Line only in new - inserted
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

  /**
   * Compute longest common subsequence of lines
   */
  private longestCommonSubsequence(a: string[], b: string[]): string[] {
    const m = a.length;
    const n = b.length;

    // DP table
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

    // Backtrack to find LCS
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

  /**
   * Compute character-level diff for modified lines
   */
  private computeCharDiff(oldText: string, newText: string): CharDiff[] {
    const diffs: CharDiff[] = [];

    // Use word-based diff for better readability
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

  /**
   * Tokenize text into words and whitespace for diff
   */
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

  /**
   * Calculate similarity between two strings (0-1)
   */
  private getSimilarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;

    const editDistance = this.levenshteinDistance(shorter, longer);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Compute Levenshtein edit distance
   */
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

  /**
   * Get change statistics
   */
  private getChangeStats(): { added: number; removed: number; modified: number } {
    let added = 0;
    let removed = 0;
    let modified = 0;

    for (const diff of this.lineDiffs) {
      if (diff.type === 'insert') {
        added++;
      } else if (diff.type === 'delete') {
        removed++;
      } else if (diff.charDiffs) {
        modified++;
      }
    }

    return { added, removed, modified };
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
