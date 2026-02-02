import { App, TFile, TFolder, Notice } from 'obsidian';
import type VaultAIPlugin from '../main';
import { VaultSearch } from '../search/VaultSearch';
import {
  MCPToolSchema,
  MCPToolResult,
  MCPToolContent,
  MCPToolsListResult,
} from './types';

// ============================================================================
// Tool Definitions
// ============================================================================

export const MCP_TOOLS: MCPToolSchema[] = [
  {
    name: 'search_vault',
    description: 'Search for notes in the vault containing specific terms. Returns file paths and matching excerpts.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_note',
    description: 'Read the full content of a specific note. Use this to get more details from a note found in search results.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path to the note (e.g., "folder/note.md")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_note',
    description: 'Create a new note in the vault. Use this when the user asks to create, write, or add a new note.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'The folder path where to create the note (e.g., "Projects" or "Daily Notes"). Use empty string for vault root.' },
        name: { type: 'string', description: 'The name of the note (without .md extension)' },
        content: { type: 'string', description: 'The markdown content of the note' },
      },
      required: ['folder', 'name', 'content'],
    },
  },
  {
    name: 'append_to_note',
    description: 'Append content to an existing note. Use this to add information to an existing note.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path to the note (e.g., "folder/note.md")' },
        content: { type: 'string', description: 'The content to append' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_folder',
    description: 'List all files and subfolders in a folder. Use "/" for vault root.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The folder path to list' },
      },
      required: ['path'],
    },
  },
  {
    name: 'rename_file',
    description: 'Rename a file in the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Current path to the file (e.g., "folder/old-name.md")' },
        newName: { type: 'string', description: 'New name for the file (without path, e.g., "new-name.md")' },
      },
      required: ['path', 'newName'],
    },
  },
  {
    name: 'rename_folder',
    description: 'Rename a folder in the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Current path to the folder (e.g., "old-folder-name")' },
        newName: { type: 'string', description: 'New name for the folder (without path)' },
      },
      required: ['path', 'newName'],
    },
  },
  {
    name: 'move_file',
    description: 'Move a file to a different folder in the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: 'Current path to the file (e.g., "folder/note.md")' },
        targetFolder: { type: 'string', description: 'Target folder path (e.g., "new-folder" or "/" for root)' },
      },
      required: ['sourcePath', 'targetFolder'],
    },
  },
  // New tools
  {
    name: 'delete_note',
    description: 'Delete a note (move to trash). This is reversible through system trash.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path to the note to delete (e.g., "folder/note.md")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_folder',
    description: 'Create a new folder in the vault.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path for the new folder (e.g., "Projects/NewFolder")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'delete_folder',
    description: 'Delete an empty folder. The folder must be empty.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path to the folder to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'grep_vault',
    description: 'Search for content in the vault using a regex pattern. More powerful than search_vault for complex patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'The regex pattern to search for' },
        folder: { type: 'string', description: 'Optional folder to limit search scope (default: entire vault)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'edit_section',
    description: 'Edit content under a specific heading in a note. Replaces all content from the heading to the next heading of same or higher level.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path to the note' },
        heading: { type: 'string', description: 'The heading text to find (without # prefix)' },
        newContent: { type: 'string', description: 'The new content to replace the section with' },
      },
      required: ['path', 'heading', 'newContent'],
    },
  },
  {
    name: 'replace_text',
    description: 'Find and replace text in a note.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The path to the note' },
        search: { type: 'string', description: 'The text to search for' },
        replace: { type: 'string', description: 'The text to replace with' },
        replaceAll: { type: 'boolean', description: 'Whether to replace all occurrences (default: false, replaces first only)' },
      },
      required: ['path', 'search', 'replace'],
    },
  },
];

// ============================================================================
// Tool Handler Class
// ============================================================================

export class MCPToolHandler {
  private plugin: VaultAIPlugin;
  private app: App;
  private vaultSearch: VaultSearch;

  constructor(plugin: VaultAIPlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.vaultSearch = new VaultSearch(plugin.app);
  }

  listTools(): MCPToolsListResult {
    return { tools: MCP_TOOLS };
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    try {
      switch (name) {
        case 'search_vault':
          return await this.searchVault(args.query as string);

        case 'read_note':
          return await this.readNote(args.path as string);

        case 'create_note':
          return await this.createNote(
            args.folder as string,
            args.name as string,
            args.content as string
          );

        case 'append_to_note':
          return await this.appendToNote(args.path as string, args.content as string);

        case 'list_folder':
          return await this.listFolder(args.path as string);

        case 'rename_file':
          return await this.renameFile(args.path as string, args.newName as string);

        case 'rename_folder':
          return await this.renameFolder(args.path as string, args.newName as string);

        case 'move_file':
          return await this.moveFile(args.sourcePath as string, args.targetFolder as string);

        case 'delete_note':
          return await this.deleteNote(args.path as string);

        case 'create_folder':
          return await this.createFolder(args.path as string);

        case 'delete_folder':
          return await this.deleteFolder(args.path as string);

        case 'grep_vault':
          return await this.grepVault(args.pattern as string, args.folder as string | undefined);

        case 'edit_section':
          return await this.editSection(
            args.path as string,
            args.heading as string,
            args.newContent as string
          );

        case 'replace_text':
          return await this.replaceText(
            args.path as string,
            args.search as string,
            args.replace as string,
            args.replaceAll as boolean | undefined
          );

        default:
          return this.errorResult(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return this.errorResult(`Error executing ${name}: ${error}`);
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private textResult(text: string): MCPToolResult {
    return {
      content: [{ type: 'text', text }],
    };
  }

  private errorResult(message: string): MCPToolResult {
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }

  private normalizePath(path: string, addMd = true): string {
    let normalized = path;
    if (addMd && !normalized.endsWith('.md')) {
      normalized += '.md';
    }
    return normalized;
  }

  // ============================================================================
  // Tool Implementations
  // ============================================================================

  private async searchVault(query: string): Promise<MCPToolResult> {
    if (!query) {
      return this.errorResult('Search query is required');
    }

    const results = await this.vaultSearch.searchFiles(query, 'vault', undefined);

    if (results.length === 0) {
      return this.textResult(`No files found matching "${query}"`);
    }

    const summary = results.slice(0, 5).map(r => {
      const matchSummary = r.matches.slice(0, 2).map(m =>
        `  - Line ${m.line}: ${m.content.slice(0, 100)}...`
      ).join('\n');
      return `- ${r.filePath}\n${matchSummary}`;
    }).join('\n\n');

    return this.textResult(`Found ${results.length} file(s) matching "${query}":\n\n${summary}`);
  }

  private async readNote(path: string): Promise<MCPToolResult> {
    if (!path) {
      return this.errorResult('Note path is required');
    }

    const normalizedPath = this.normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file) {
      // Try without .md if it was added
      const altPath = path.endsWith('.md') ? path.slice(0, -3) : path;
      const altFile = this.app.vault.getAbstractFileByPath(altPath);
      if (!altFile) {
        return this.errorResult(`Note not found: ${path}`);
      }
    }

    if (!(file instanceof TFile)) {
      return this.errorResult(`Path is not a file: ${path}`);
    }

    const content = await this.app.vault.read(file);
    const truncated = content.length > 3000
      ? content.slice(0, 3000) + '\n\n[Content truncated...]'
      : content;

    return this.textResult(`Content of ${normalizedPath}:\n\n${truncated}`);
  }

  private async createNote(folder: string, name: string, content: string): Promise<MCPToolResult> {
    if (!name) {
      return this.errorResult('Note name is required');
    }

    // Normalize folder path
    let folderPath = folder?.trim() || '';
    if (folderPath === '/' || folderPath === '.') {
      folderPath = '';
    }

    // Build full path
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;

    // Check if file already exists
    const existing = this.app.vault.getAbstractFileByPath(fullPath);
    if (existing) {
      return this.errorResult(
        `A note already exists at ${fullPath}. Use append_to_note to add content to it, or choose a different name.`
      );
    }

    // Ensure folder exists
    if (folderPath) {
      const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
      if (!folderExists) {
        const parts = folderPath.split('/').filter(p => p);
        let currentPath = '';
        for (const part of parts) {
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          const exists = this.app.vault.getAbstractFileByPath(currentPath);
          if (!exists) {
            await this.app.vault.createFolder(currentPath);
          }
        }
      }
    }

    // Create the note
    const noteContent = content || '';
    await this.app.vault.create(fullPath, noteContent);

    // Add to undo stack
    const undoOp = {
      id: `create-${Date.now()}`,
      timestamp: Date.now(),
      description: `Created note: ${fullPath}`,
      operations: [{ type: 'create-file' as const, sourcePath: fullPath, content: noteContent }],
      reverseOperations: [{ type: 'delete' as const, sourcePath: fullPath }],
    };
    this.plugin.undoStack.push(undoOp);

    new Notice(`Created note: ${fullPath}`);

    return this.textResult(`Successfully created note at ${fullPath}`);
  }

  private async appendToNote(path: string, content: string): Promise<MCPToolResult> {
    if (!path) {
      return this.errorResult('Note path is required');
    }
    if (!content) {
      return this.errorResult('Content to append is required');
    }

    const normalizedPath = this.normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file || !(file instanceof TFile)) {
      return this.errorResult(`Note not found: ${path}`);
    }

    const currentContent = await this.app.vault.read(file);
    const newContent = currentContent + '\n\n' + content;

    // Store for undo
    const undoOp = {
      id: `append-${Date.now()}`,
      timestamp: Date.now(),
      description: `Appended to note: ${normalizedPath}`,
      operations: [{ type: 'modify' as const, sourcePath: normalizedPath, content: newContent }],
      reverseOperations: [{ type: 'modify' as const, sourcePath: normalizedPath, content: currentContent }],
    };

    await this.app.vault.modify(file, newContent);
    this.plugin.undoStack.push(undoOp);

    new Notice(`Updated note: ${normalizedPath}`);

    return this.textResult(`Successfully appended content to ${normalizedPath}`);
  }

  private async listFolder(path: string): Promise<MCPToolResult> {
    let folderPath = path?.trim() || '/';
    if (folderPath === '/') {
      folderPath = '';
    }

    let folder: TFolder | null = null;

    if (!folderPath) {
      folder = this.app.vault.getRoot();
    } else {
      const abstractFile = this.app.vault.getAbstractFileByPath(folderPath);
      if (abstractFile instanceof TFolder) {
        folder = abstractFile;
      }
    }

    if (!folder) {
      return this.errorResult(`Folder not found: ${path}`);
    }

    const items: string[] = [];

    for (const child of folder.children) {
      if (child instanceof TFolder) {
        items.push(`[folder] ${child.name}/`);
      } else if (child instanceof TFile) {
        items.push(`[file] ${child.name}`);
      }
    }

    if (items.length === 0) {
      return this.textResult(`Folder "${path || '/'}" is empty`);
    }

    return this.textResult(`Contents of "${path || '/'}":\n${items.join('\n')}`);
  }

  private async renameFile(path: string, newName: string): Promise<MCPToolResult> {
    if (!path) {
      return this.errorResult('File path is required');
    }
    if (!newName) {
      return this.errorResult('New name is required');
    }

    const normalizedPath = this.normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!file || !(file instanceof TFile)) {
      return this.errorResult(`File not found: ${path}`);
    }

    // Ensure new name has .md extension
    let normalizedNewName = newName;
    if (!normalizedNewName.endsWith('.md')) {
      normalizedNewName += '.md';
    }

    // Build new path
    const folder = file.parent?.path || '';
    const newPath = folder ? `${folder}/${normalizedNewName}` : normalizedNewName;

    // Check if target exists
    const existing = this.app.vault.getAbstractFileByPath(newPath);
    if (existing) {
      return this.errorResult(`A file already exists at ${newPath}`);
    }

    // Store for undo
    const undoOp = {
      id: `rename-file-${Date.now()}`,
      timestamp: Date.now(),
      description: `Renamed file: ${normalizedPath} -> ${newPath}`,
      operations: [{ type: 'rename' as const, sourcePath: normalizedPath, targetPath: newPath }],
      reverseOperations: [{ type: 'rename' as const, sourcePath: newPath, targetPath: normalizedPath }],
    };

    await this.app.fileManager.renameFile(file, newPath);
    this.plugin.undoStack.push(undoOp);

    new Notice(`Renamed: ${file.name} -> ${normalizedNewName}`);

    return this.textResult(`Successfully renamed file from ${normalizedPath} to ${newPath}`);
  }

  private async renameFolder(path: string, newName: string): Promise<MCPToolResult> {
    if (!path) {
      return this.errorResult('Folder path is required');
    }
    if (!newName) {
      return this.errorResult('New name is required');
    }

    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder || !(folder instanceof TFolder)) {
      return this.errorResult(`Folder not found: ${path}`);
    }

    // Build new path
    const parent = folder.parent?.path || '';
    const newPath = parent ? `${parent}/${newName}` : newName;

    // Check if target exists
    const existing = this.app.vault.getAbstractFileByPath(newPath);
    if (existing) {
      return this.errorResult(`A folder already exists at ${newPath}`);
    }

    // Store for undo
    const undoOp = {
      id: `rename-folder-${Date.now()}`,
      timestamp: Date.now(),
      description: `Renamed folder: ${path} -> ${newPath}`,
      operations: [{ type: 'rename' as const, sourcePath: path, targetPath: newPath }],
      reverseOperations: [{ type: 'rename' as const, sourcePath: newPath, targetPath: path }],
    };

    await this.app.fileManager.renameFile(folder, newPath);
    this.plugin.undoStack.push(undoOp);

    new Notice(`Renamed folder: ${folder.name} -> ${newName}`);

    return this.textResult(`Successfully renamed folder from ${path} to ${newPath}`);
  }

  private async moveFile(sourcePath: string, targetFolder: string): Promise<MCPToolResult> {
    if (!sourcePath) {
      return this.errorResult('Source file path is required');
    }
    if (targetFolder === undefined) {
      return this.errorResult('Target folder is required');
    }

    const normalizedSource = this.normalizePath(sourcePath);
    const file = this.app.vault.getAbstractFileByPath(normalizedSource);
    if (!file || !(file instanceof TFile)) {
      return this.errorResult(`File not found: ${sourcePath}`);
    }

    // Normalize target folder
    let normalizedTarget = targetFolder.trim();
    if (normalizedTarget === '/') {
      normalizedTarget = '';
    }

    // Ensure target folder exists
    if (normalizedTarget) {
      const targetFolderFile = this.app.vault.getAbstractFileByPath(normalizedTarget);
      if (!targetFolderFile) {
        const parts = normalizedTarget.split('/').filter(p => p);
        let currentPath = '';
        for (const part of parts) {
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          const exists = this.app.vault.getAbstractFileByPath(currentPath);
          if (!exists) {
            await this.app.vault.createFolder(currentPath);
          }
        }
      }
    }

    // Build new path
    const newPath = normalizedTarget ? `${normalizedTarget}/${file.name}` : file.name;

    // Check if target exists
    const existing = this.app.vault.getAbstractFileByPath(newPath);
    if (existing) {
      return this.errorResult(`A file already exists at ${newPath}`);
    }

    // Store for undo
    const undoOp = {
      id: `move-file-${Date.now()}`,
      timestamp: Date.now(),
      description: `Moved file: ${normalizedSource} -> ${newPath}`,
      operations: [{ type: 'move' as const, sourcePath: normalizedSource, targetPath: newPath }],
      reverseOperations: [{ type: 'move' as const, sourcePath: newPath, targetPath: normalizedSource }],
    };

    await this.app.fileManager.renameFile(file, newPath);
    this.plugin.undoStack.push(undoOp);

    new Notice(`Moved: ${file.name} -> ${targetFolder || '/'}`);

    return this.textResult(`Successfully moved file from ${normalizedSource} to ${newPath}`);
  }

  // ============================================================================
  // New Tool Implementations
  // ============================================================================

  private async deleteNote(path: string): Promise<MCPToolResult> {
    if (!path) {
      return this.errorResult('Note path is required');
    }

    const normalizedPath = this.normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file || !(file instanceof TFile)) {
      return this.errorResult(`Note not found: ${path}`);
    }

    // Read content before deleting for undo
    const content = await this.app.vault.read(file);
    const folder = file.parent?.path || '';

    // Store for undo
    const undoOp = {
      id: `delete-note-${Date.now()}`,
      timestamp: Date.now(),
      description: `Deleted note: ${normalizedPath}`,
      operations: [{ type: 'delete' as const, sourcePath: normalizedPath }],
      reverseOperations: [{ type: 'create-file' as const, sourcePath: normalizedPath, content }],
    };

    // Move to trash
    await this.app.vault.trash(file, true);
    this.plugin.undoStack.push(undoOp);

    new Notice(`Deleted note: ${normalizedPath}`);

    return this.textResult(`Successfully deleted note: ${normalizedPath}`);
  }

  private async createFolder(path: string): Promise<MCPToolResult> {
    if (!path) {
      return this.errorResult('Folder path is required');
    }

    // Normalize path
    let folderPath = path.trim();
    if (folderPath === '/' || folderPath === '.') {
      return this.errorResult('Cannot create root folder');
    }

    // Check if folder already exists
    const existing = this.app.vault.getAbstractFileByPath(folderPath);
    if (existing) {
      return this.errorResult(`Folder already exists: ${folderPath}`);
    }

    // Create folder hierarchy
    const parts = folderPath.split('/').filter(p => p);
    let currentPath = '';
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const exists = this.app.vault.getAbstractFileByPath(currentPath);
      if (!exists) {
        await this.app.vault.createFolder(currentPath);
      }
    }

    // Store for undo
    const undoOp = {
      id: `create-folder-${Date.now()}`,
      timestamp: Date.now(),
      description: `Created folder: ${folderPath}`,
      operations: [{ type: 'create-folder' as const, sourcePath: folderPath }],
      reverseOperations: [{ type: 'delete' as const, sourcePath: folderPath }],
    };
    this.plugin.undoStack.push(undoOp);

    new Notice(`Created folder: ${folderPath}`);

    return this.textResult(`Successfully created folder: ${folderPath}`);
  }

  private async deleteFolder(path: string): Promise<MCPToolResult> {
    if (!path) {
      return this.errorResult('Folder path is required');
    }

    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder || !(folder instanceof TFolder)) {
      return this.errorResult(`Folder not found: ${path}`);
    }

    // Check if folder is empty
    if (folder.children.length > 0) {
      return this.errorResult(`Folder is not empty: ${path}. Delete or move its contents first.`);
    }

    // Store for undo
    const undoOp = {
      id: `delete-folder-${Date.now()}`,
      timestamp: Date.now(),
      description: `Deleted folder: ${path}`,
      operations: [{ type: 'delete' as const, sourcePath: path }],
      reverseOperations: [{ type: 'create-folder' as const, sourcePath: path }],
    };

    await this.app.vault.delete(folder);
    this.plugin.undoStack.push(undoOp);

    new Notice(`Deleted folder: ${path}`);

    return this.textResult(`Successfully deleted folder: ${path}`);
  }

  private async grepVault(pattern: string, folder?: string): Promise<MCPToolResult> {
    if (!pattern) {
      return this.errorResult('Pattern is required');
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'gi');
    } catch (e) {
      return this.errorResult(`Invalid regex pattern: ${pattern}`);
    }

    const files = this.app.vault.getMarkdownFiles();
    const results: { file: string; matches: { line: number; content: string }[] }[] = [];

    for (const file of files) {
      // Filter by folder if specified
      if (folder && folder !== '/' && !file.path.startsWith(folder)) {
        continue;
      }

      const content = await this.app.vault.read(file);
      const lines = content.split('\n');
      const fileMatches: { line: number; content: string }[] = [];

      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          fileMatches.push({
            line: i + 1,
            content: lines[i].slice(0, 100),
          });
          regex.lastIndex = 0; // Reset for global regex
        }
      }

      if (fileMatches.length > 0) {
        results.push({
          file: file.path,
          matches: fileMatches.slice(0, 5), // Limit matches per file
        });
      }
    }

    if (results.length === 0) {
      return this.textResult(`No matches found for pattern "${pattern}"`);
    }

    const summary = results.slice(0, 10).map(r => {
      const matchSummary = r.matches.map(m => `  Line ${m.line}: ${m.content}`).join('\n');
      return `- ${r.file}\n${matchSummary}`;
    }).join('\n\n');

    return this.textResult(
      `Found ${results.length} file(s) matching pattern "${pattern}":\n\n${summary}`
    );
  }

  private async editSection(path: string, heading: string, newContent: string): Promise<MCPToolResult> {
    if (!path) {
      return this.errorResult('Note path is required');
    }
    if (!heading) {
      return this.errorResult('Heading is required');
    }

    const normalizedPath = this.normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file || !(file instanceof TFile)) {
      return this.errorResult(`Note not found: ${path}`);
    }

    const content = await this.app.vault.read(file);
    const lines = content.split('\n');

    // Find the heading
    let headingLineIndex = -1;
    let headingLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
      if (match && match[2].trim().toLowerCase() === heading.trim().toLowerCase()) {
        headingLineIndex = i;
        headingLevel = match[1].length;
        break;
      }
    }

    if (headingLineIndex === -1) {
      return this.errorResult(`Heading "${heading}" not found in ${path}`);
    }

    // Find the end of the section (next heading of same or higher level)
    let sectionEndIndex = lines.length;
    for (let i = headingLineIndex + 1; i < lines.length; i++) {
      const match = lines[i].match(/^(#{1,6})\s+/);
      if (match && match[1].length <= headingLevel) {
        sectionEndIndex = i;
        break;
      }
    }

    // Build new content
    const beforeSection = lines.slice(0, headingLineIndex + 1);
    const afterSection = lines.slice(sectionEndIndex);
    const newLines = [...beforeSection, '', newContent, '', ...afterSection];
    const newFileContent = newLines.join('\n');

    // Store for undo
    const undoOp = {
      id: `edit-section-${Date.now()}`,
      timestamp: Date.now(),
      description: `Edited section "${heading}" in ${normalizedPath}`,
      operations: [{ type: 'modify' as const, sourcePath: normalizedPath, content: newFileContent }],
      reverseOperations: [{ type: 'modify' as const, sourcePath: normalizedPath, content }],
    };

    await this.app.vault.modify(file, newFileContent);
    this.plugin.undoStack.push(undoOp);

    new Notice(`Updated section "${heading}" in ${normalizedPath}`);

    return this.textResult(`Successfully updated section "${heading}" in ${normalizedPath}`);
  }

  private async replaceText(
    path: string,
    search: string,
    replace: string,
    replaceAll?: boolean
  ): Promise<MCPToolResult> {
    if (!path) {
      return this.errorResult('Note path is required');
    }
    if (!search) {
      return this.errorResult('Search text is required');
    }

    const normalizedPath = this.normalizePath(path);
    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file || !(file instanceof TFile)) {
      return this.errorResult(`Note not found: ${path}`);
    }

    const content = await this.app.vault.read(file);

    if (!content.includes(search)) {
      return this.errorResult(`Text "${search}" not found in ${path}`);
    }

    let newContent: string;
    let count = 0;

    if (replaceAll) {
      // Count occurrences
      let temp = content;
      while (temp.includes(search)) {
        temp = temp.replace(search, '');
        count++;
      }
      newContent = content.split(search).join(replace);
    } else {
      newContent = content.replace(search, replace);
      count = 1;
    }

    // Store for undo
    const undoOp = {
      id: `replace-text-${Date.now()}`,
      timestamp: Date.now(),
      description: `Replaced text in ${normalizedPath}`,
      operations: [{ type: 'modify' as const, sourcePath: normalizedPath, content: newContent }],
      reverseOperations: [{ type: 'modify' as const, sourcePath: normalizedPath, content }],
    };

    await this.app.vault.modify(file, newContent);
    this.plugin.undoStack.push(undoOp);

    new Notice(`Replaced ${count} occurrence(s) in ${normalizedPath}`);

    return this.textResult(
      `Successfully replaced ${count} occurrence(s) of "${search}" with "${replace}" in ${normalizedPath}`
    );
  }
}
