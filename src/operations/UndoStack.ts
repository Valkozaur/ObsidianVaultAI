import { App, Notice } from 'obsidian';
import { UndoableOperation, FileOperation } from '../types';
import { FileOperations } from './FileOperations';

export class UndoStack {
  private stack: UndoableOperation[] = [];
  private maxSize: number = 10;

  push(operation: UndoableOperation): void {
    this.stack.push(operation);

    // Trim to max size
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
    }
  }

  async undo(app: App): Promise<UndoableOperation | null> {
    const operation = this.stack.pop();

    if (!operation) {
      return null;
    }

    const fileOps = new FileOperations(app);

    try {
      // Execute reverse operations
      for (const reverseOp of operation.reverseOperations) {
        await this.executeReverseOperation(app, reverseOp);
      }

      return operation;
    } catch (error) {
      console.error('Undo failed:', error);
      // Put the operation back on the stack
      this.stack.push(operation);
      throw error;
    }
  }

  private async executeReverseOperation(
    app: App,
    op: FileOperation
  ): Promise<void> {
    switch (op.type) {
      case 'create-folder':
        await app.vault.createFolder(op.sourcePath);
        break;

      case 'create-file':
        await app.vault.create(op.sourcePath, op.content || '');
        break;

      case 'move':
      case 'rename':
        if (op.targetPath) {
          const file = app.vault.getAbstractFileByPath(op.sourcePath);
          if (file) {
            await app.vault.rename(file, op.targetPath);
          }
        }
        break;

      case 'delete':
        const file = app.vault.getAbstractFileByPath(op.sourcePath);
        if (file) {
          await app.vault.trash(file, true);
        }
        break;

      case 'modify':
        const modFile = app.vault.getAbstractFileByPath(op.sourcePath);
        if (modFile && op.content !== undefined) {
          await app.vault.modify(modFile as any, op.content);
        }
        break;
    }
  }

  getHistory(): UndoableOperation[] {
    return [...this.stack];
  }

  clear(): void {
    this.stack = [];
  }

  get length(): number {
    return this.stack.length;
  }

  peek(): UndoableOperation | undefined {
    return this.stack[this.stack.length - 1];
  }
}
