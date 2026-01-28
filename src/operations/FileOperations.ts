import { App, TFile, TFolder, Notice } from 'obsidian';
import { FileOperation, UndoableOperation } from '../types';
import { LinkUpdater } from './LinkUpdater';

export class FileOperations {
  private app: App;
  private linkUpdater: LinkUpdater;

  constructor(app: App) {
    this.app = app;
    this.linkUpdater = new LinkUpdater(app);
  }

  async executeOperations(
    operations: FileOperation[],
    description: string
  ): Promise<UndoableOperation | null> {
    const reverseOperations: FileOperation[] = [];
    const executedOps: FileOperation[] = [];

    try {
      for (const op of operations) {
        const reverseOp = await this.executeOperation(op);
        if (reverseOp) {
          reverseOperations.unshift(reverseOp); // Add to front for correct undo order
          executedOps.push(op);
        }
      }

      return {
        id: `op-${Date.now()}`,
        timestamp: Date.now(),
        description,
        operations: executedOps,
        reverseOperations,
      };
    } catch (error) {
      console.error('Operation failed:', error);

      // Attempt to rollback executed operations
      for (const reverseOp of reverseOperations) {
        try {
          await this.executeOperation(reverseOp);
        } catch (rollbackError) {
          console.error('Rollback failed:', rollbackError);
        }
      }

      throw error;
    }
  }

  private async executeOperation(op: FileOperation): Promise<FileOperation | null> {
    switch (op.type) {
      case 'create-folder':
        return this.createFolder(op.sourcePath);

      case 'create-file':
        return this.createFile(op.sourcePath, op.content || '');

      case 'move':
        if (!op.targetPath) throw new Error('Target path required for move');
        return this.moveFile(op.sourcePath, op.targetPath);

      case 'rename':
        if (!op.targetPath) throw new Error('Target path required for rename');
        return this.renameFile(op.sourcePath, op.targetPath);

      case 'delete':
        return this.deleteFile(op.sourcePath);

      case 'modify':
        if (op.content === undefined) throw new Error('Content required for modify');
        return this.modifyFile(op.sourcePath, op.content);

      default:
        console.warn(`Unknown operation type: ${op.type}`);
        return null;
    }
  }

  private async createFolder(path: string): Promise<FileOperation> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      throw new Error(`Folder already exists: ${path}`);
    }

    await this.app.vault.createFolder(path);

    return {
      type: 'delete',
      sourcePath: path,
    };
  }

  private async createFile(path: string, content: string): Promise<FileOperation> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing) {
      throw new Error(`File already exists: ${path}`);
    }

    await this.app.vault.create(path, content);

    return {
      type: 'delete',
      sourcePath: path,
    };
  }

  private async moveFile(sourcePath: string, targetPath: string): Promise<FileOperation> {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!file) {
      throw new Error(`File not found: ${sourcePath}`);
    }

    // Ensure target folder exists
    const targetFolder = targetPath.substring(0, targetPath.lastIndexOf('/'));
    if (targetFolder) {
      await this.ensureFolderExists(targetFolder);
    }

    await this.app.vault.rename(file, targetPath);

    // Update links pointing to this file
    await this.linkUpdater.updateLinksAfterMove(sourcePath, targetPath);

    return {
      type: 'move',
      sourcePath: targetPath,
      targetPath: sourcePath,
    };
  }

  private async renameFile(sourcePath: string, targetPath: string): Promise<FileOperation> {
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!file) {
      throw new Error(`File not found: ${sourcePath}`);
    }

    await this.app.vault.rename(file, targetPath);

    // Update links pointing to this file
    await this.linkUpdater.updateLinksAfterMove(sourcePath, targetPath);

    return {
      type: 'rename',
      sourcePath: targetPath,
      targetPath: sourcePath,
    };
  }

  private async deleteFile(path: string): Promise<FileOperation> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      throw new Error(`File not found: ${path}`);
    }

    // Store content before deletion for undo
    let content = '';
    if (file instanceof TFile) {
      content = await this.app.vault.read(file);
    }

    // Move to trash instead of permanent delete
    await this.app.vault.trash(file, true);

    if (file instanceof TFile) {
      return {
        type: 'create-file',
        sourcePath: path,
        content,
      };
    } else {
      return {
        type: 'create-folder',
        sourcePath: path,
      };
    }
  }

  private async modifyFile(path: string, newContent: string): Promise<FileOperation> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found: ${path}`);
    }

    // Store old content for undo
    const oldContent = await this.app.vault.read(file);

    await this.app.vault.modify(file, newContent);

    return {
      type: 'modify',
      sourcePath: path,
      content: oldContent,
    };
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    const parts = folderPath.split('/').filter((p) => p);
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(currentPath);

      if (!existing) {
        await this.app.vault.createFolder(currentPath);
      } else if (!(existing instanceof TFolder)) {
        throw new Error(`Path exists but is not a folder: ${currentPath}`);
      }
    }
  }

  async mergeFiles(sourcePaths: string[], targetPath: string): Promise<UndoableOperation> {
    const contents: string[] = [];
    const operations: FileOperation[] = [];
    const reverseOperations: FileOperation[] = [];

    // Read all source files
    for (const sourcePath of sourcePaths) {
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (file instanceof TFile) {
        const content = await this.app.vault.read(file);
        contents.push(`# From: ${file.name}\n\n${content}`);

        // Store for undo
        reverseOperations.push({
          type: 'create-file',
          sourcePath,
          content,
        });
      }
    }

    // Create merged file
    const mergedContent = contents.join('\n\n---\n\n');
    const existingTarget = this.app.vault.getAbstractFileByPath(targetPath);

    if (existingTarget instanceof TFile) {
      const oldContent = await this.app.vault.read(existingTarget);
      await this.app.vault.modify(existingTarget, mergedContent);

      reverseOperations.push({
        type: 'modify',
        sourcePath: targetPath,
        content: oldContent,
      });
    } else {
      await this.app.vault.create(targetPath, mergedContent);

      reverseOperations.push({
        type: 'delete',
        sourcePath: targetPath,
      });
    }

    operations.push({
      type: 'create-file',
      sourcePath: targetPath,
      content: mergedContent,
    });

    // Delete source files
    for (const sourcePath of sourcePaths) {
      if (sourcePath !== targetPath) {
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (file) {
          await this.app.vault.trash(file, true);
          operations.push({
            type: 'delete',
            sourcePath,
          });
        }
      }
    }

    return {
      id: `merge-${Date.now()}`,
      timestamp: Date.now(),
      description: `Merged ${sourcePaths.length} files into ${targetPath}`,
      operations,
      reverseOperations,
    };
  }
}
