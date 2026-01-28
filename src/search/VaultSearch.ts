import { App, TFile, TFolder } from 'obsidian';
import { SearchResult, SearchMatch, ContextScope } from '../types';

export class VaultSearch {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async searchFiles(
    query: string,
    scope: ContextScope,
    currentFilePath?: string
  ): Promise<SearchResult[]> {
    const files = await this.getFilesInScope(scope, currentFilePath);
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    const searchTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);

    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      const matches = this.findMatches(content, searchTerms);

      if (matches.length > 0) {
        results.push({
          filePath: file.path,
          fileName: file.name,
          matches,
        });
      }
    }

    // Sort by number of matches (most relevant first)
    results.sort((a, b) => b.matches.length - a.matches.length);

    return results;
  }

  private findMatches(content: string, searchTerms: string[]): SearchMatch[] {
    const lines = content.split('\n');
    const matches: SearchMatch[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLower = line.toLowerCase();

      // Check if any search term matches
      const matchedTerms = searchTerms.filter((term) => lineLower.includes(term));

      if (matchedTerms.length > 0) {
        // Get context (2 lines before and after)
        const contextStart = Math.max(0, i - 2);
        const contextEnd = Math.min(lines.length - 1, i + 2);
        const contextLines = lines.slice(contextStart, contextEnd + 1);

        matches.push({
          line: i + 1,
          content: line.trim(),
          context: contextLines.join('\n'),
        });
      }
    }

    // Limit to top 5 matches per file
    return matches.slice(0, 5);
  }

  async getFilesInScope(
    scope: ContextScope,
    currentFilePath?: string
  ): Promise<TFile[]> {
    switch (scope) {
      case 'current':
        return this.getCurrentFile(currentFilePath);
      case 'linked':
        return this.getLinkedFiles(currentFilePath);
      case 'folder':
        return this.getFilesInCurrentFolder(currentFilePath);
      case 'vault':
      default:
        return this.app.vault.getMarkdownFiles();
    }
  }

  private getCurrentFile(currentFilePath?: string): TFile[] {
    if (!currentFilePath) {
      const activeFile = this.app.workspace.getActiveFile();
      return activeFile ? [activeFile] : [];
    }

    const file = this.app.vault.getAbstractFileByPath(currentFilePath);
    return file instanceof TFile ? [file] : [];
  }

  private getLinkedFiles(currentFilePath?: string): TFile[] {
    const currentFiles = this.getCurrentFile(currentFilePath);
    if (currentFiles.length === 0) return [];

    const currentFile = currentFiles[0];
    const linkedFiles = new Set<TFile>([currentFile]);

    // Get outgoing links
    const cache = this.app.metadataCache.getFileCache(currentFile);
    if (cache?.links) {
      for (const link of cache.links) {
        const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
          link.link,
          currentFile.path
        );
        if (linkedFile instanceof TFile) {
          linkedFiles.add(linkedFile);
        }
      }
    }

    // Get backlinks (files that link to current file)
    const resolvedLinks = this.app.metadataCache.resolvedLinks;
    for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
      if (links[currentFile.path]) {
        const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        if (sourceFile instanceof TFile) {
          linkedFiles.add(sourceFile);
        }
      }
    }

    return Array.from(linkedFiles);
  }

  private getFilesInCurrentFolder(currentFilePath?: string): TFile[] {
    const currentFiles = this.getCurrentFile(currentFilePath);
    if (currentFiles.length === 0) return this.app.vault.getMarkdownFiles();

    const currentFile = currentFiles[0];
    const folderPath = currentFile.parent?.path || '';

    return this.app.vault.getMarkdownFiles().filter((f) => {
      const fileFolder = f.parent?.path || '';
      return fileFolder === folderPath;
    });
  }

  async getFileContent(filePath: string): Promise<string | null> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      return await this.app.vault.cachedRead(file);
    }
    return null;
  }

  listFilesInFolder(folderPath: string): string[] {
    const folder = this.app.vault.getAbstractFileByPath(folderPath);

    if (folder instanceof TFolder) {
      return folder.children
        .filter((f) => f instanceof TFile)
        .map((f) => f.path);
    }

    // If no folder specified, list root markdown files
    if (!folderPath || folderPath === '/') {
      return this.app.vault.getMarkdownFiles().map((f) => f.path);
    }

    return [];
  }
}
