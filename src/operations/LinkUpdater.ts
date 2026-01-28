import { App, TFile } from 'obsidian';

export class LinkUpdater {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async updateLinksAfterMove(oldPath: string, newPath: string): Promise<void> {
    // Find all files that link to the old path
    const filesToUpdate = this.findFilesLinkingTo(oldPath);

    for (const file of filesToUpdate) {
      await this.updateLinksInFile(file, oldPath, newPath);
    }
  }

  private findFilesLinkingTo(targetPath: string): TFile[] {
    const linkingFiles: TFile[] = [];
    const resolvedLinks = this.app.metadataCache.resolvedLinks;

    for (const [sourcePath, links] of Object.entries(resolvedLinks)) {
      if (links[targetPath]) {
        const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
        if (sourceFile instanceof TFile) {
          linkingFiles.push(sourceFile);
        }
      }
    }

    return linkingFiles;
  }

  private async updateLinksInFile(
    file: TFile,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    let content = await this.app.vault.read(file);
    let modified = false;

    // Get old and new file names (without extension for wiki links)
    const oldName = this.getFileName(oldPath);
    const newName = this.getFileName(newPath);
    const oldNameNoExt = oldName.replace(/\.md$/, '');
    const newNameNoExt = newName.replace(/\.md$/, '');

    // Update wiki-style links: [[old-name]] or [[old-name|display]]
    const wikiLinkRegex = new RegExp(
      `\\[\\[${this.escapeRegex(oldNameNoExt)}(\\|[^\\]]*)?\\]\\]`,
      'g'
    );

    content = content.replace(wikiLinkRegex, (match, displayPart) => {
      modified = true;
      return `[[${newNameNoExt}${displayPart || ''}]]`;
    });

    // Update wiki-style links with full path: [[folder/old-name]]
    const oldPathNoExt = oldPath.replace(/\.md$/, '');
    const newPathNoExt = newPath.replace(/\.md$/, '');

    const wikiPathLinkRegex = new RegExp(
      `\\[\\[${this.escapeRegex(oldPathNoExt)}(\\|[^\\]]*)?\\]\\]`,
      'g'
    );

    content = content.replace(wikiPathLinkRegex, (match, displayPart) => {
      modified = true;
      return `[[${newPathNoExt}${displayPart || ''}]]`;
    });

    // Update markdown-style links: [text](old-path.md) or [text](old-path)
    const mdLinkRegex = new RegExp(
      `\\[([^\\]]*)\\]\\(${this.escapeRegex(oldPath)}\\)`,
      'g'
    );

    content = content.replace(mdLinkRegex, (match, text) => {
      modified = true;
      return `[${text}](${newPath})`;
    });

    // Also handle URL-encoded paths
    const encodedOldPath = encodeURIComponent(oldPath);
    const encodedNewPath = encodeURIComponent(newPath);

    const encodedMdLinkRegex = new RegExp(
      `\\[([^\\]]*)\\]\\(${this.escapeRegex(encodedOldPath)}\\)`,
      'g'
    );

    content = content.replace(encodedMdLinkRegex, (match, text) => {
      modified = true;
      return `[${text}](${encodedNewPath})`;
    });

    if (modified) {
      await this.app.vault.modify(file, content);
    }
  }

  private getFileName(path: string): string {
    const parts = path.split('/');
    return parts[parts.length - 1];
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
