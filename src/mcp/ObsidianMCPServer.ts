import { App, TFile, TFolder, Notice } from 'obsidian';
import * as http from 'http';
import type VaultAIPlugin from '../main';
import { VaultSearch } from '../search/VaultSearch';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  MCPToolDefinition,
  ToolCallParams,
  ToolCallResult,
  InitializeParams,
  InitializeResult,
  ToolsListResult,
  MCP_PROTOCOL_VERSION,
  MCP_METHODS,
  JSON_RPC_ERRORS,
  createJsonRpcResponse,
  createJsonRpcError,
  isJsonRpcRequest,
  isJsonRpcNotification,
} from './MCPProtocol';

/**
 * MCP Server that exposes Obsidian vault tools to LMStudio
 * Implements the Model Context Protocol over HTTP
 */
export class ObsidianMCPServer {
  private server: http.Server | null = null;
  private plugin: VaultAIPlugin;
  private app: App;
  private vaultSearch: VaultSearch;
  private isInitialized = false;
  private sessionId: string | null = null;

  constructor(plugin: VaultAIPlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.vaultSearch = new VaultSearch(plugin.app);
  }

  /**
   * Start the MCP server
   */
  async start(): Promise<void> {
    const port = this.plugin.settings.mcpServerPort || 3456;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[Vault AI MCP] Port ${port} is already in use`);
          new Notice(`MCP Server: Port ${port} is already in use`);
        } else {
          console.error('[Vault AI MCP] Server error:', err);
        }
        reject(err);
      });

      // Bind to localhost only for security
      this.server.listen(port, '127.0.0.1', () => {
        console.log(`[Vault AI MCP] Server running on http://127.0.0.1:${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the MCP server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('[Vault AI MCP] Server stopped');
          this.server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  /**
   * Get server URL
   */
  getServerUrl(): string {
    const port = this.plugin.settings.mcpServerPort || 3456;
    return `http://127.0.0.1:${port}`;
  }

  /**
   * Handle incoming HTTP request
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // Set CORS headers for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Only accept POST for JSON-RPC
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(createJsonRpcError(0, JSON_RPC_ERRORS.INVALID_REQUEST, 'Method not allowed')));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const message = JSON.parse(body);
        const response = await this.handleJsonRpcMessage(message);

        if (response) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } else {
          // Notification - no response needed
          res.writeHead(202);
          res.end();
        }
      } catch (error) {
        console.error('[Vault AI MCP] Request error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(createJsonRpcError(0, JSON_RPC_ERRORS.PARSE_ERROR, 'Parse error')));
      }
    });
  }

  /**
   * Handle JSON-RPC message
   */
  private async handleJsonRpcMessage(message: unknown): Promise<JsonRpcResponse | null> {
    // Handle notification (no response needed)
    if (isJsonRpcNotification(message)) {
      if (message.method === MCP_METHODS.INITIALIZED) {
        this.isInitialized = true;
        console.log('[Vault AI MCP] Client initialized');
      }
      return null;
    }

    // Handle request
    if (!isJsonRpcRequest(message)) {
      return createJsonRpcError(0, JSON_RPC_ERRORS.INVALID_REQUEST, 'Invalid request');
    }

    const { id, method, params } = message;

    try {
      switch (method) {
        case MCP_METHODS.INITIALIZE:
          return this.handleInitialize(id, params as InitializeParams);

        case MCP_METHODS.TOOLS_LIST:
          return this.handleToolsList(id);

        case MCP_METHODS.TOOLS_CALL:
          return await this.handleToolsCall(id, params as ToolCallParams);

        case MCP_METHODS.PING:
          return createJsonRpcResponse(id, {});

        default:
          return createJsonRpcError(id, JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Unknown method: ${method}`);
      }
    } catch (error) {
      console.error(`[Vault AI MCP] Error handling ${method}:`, error);
      return createJsonRpcError(
        id,
        JSON_RPC_ERRORS.INTERNAL_ERROR,
        error instanceof Error ? error.message : 'Internal error'
      );
    }
  }

  /**
   * Handle initialize request
   */
  private handleInitialize(id: string | number, params: InitializeParams): JsonRpcResponse {
    console.log('[Vault AI MCP] Initialize request from:', params.clientInfo?.name);

    // Generate session ID
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const result: InitializeResult = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: 'obsidian-vault-ai',
        version: '1.0.0',
        title: 'Obsidian Vault AI',
      },
      instructions: 'This MCP server provides tools to interact with your Obsidian vault. You can search notes, read content, create notes, and more.',
    };

    return createJsonRpcResponse(id, result);
  }

  /**
   * Handle tools/list request
   */
  private handleToolsList(id: string | number): JsonRpcResponse {
    const result: ToolsListResult = {
      tools: this.getToolDefinitions(),
    };

    return createJsonRpcResponse(id, result);
  }

  /**
   * Handle tools/call request
   */
  private async handleToolsCall(id: string | number, params: ToolCallParams): Promise<JsonRpcResponse> {
    const { name, arguments: args } = params;

    console.log(`[Vault AI MCP] Tool call: ${name}`, args);

    try {
      const result = await this.executeTool(name, args || {});
      return createJsonRpcResponse(id, result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const result: ToolCallResult = {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };
      return createJsonRpcResponse(id, result);
    }
  }

  /**
   * Get all tool definitions
   */
  private getToolDefinitions(): MCPToolDefinition[] {
    return [
      {
        name: 'search_vault',
        description: 'Search for notes in the Obsidian vault containing specific terms. Returns file paths and matching excerpts.',
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
        name: 'get_current_page',
        description: 'Get the content of the currently open/active page in Obsidian. Use this when the user asks about "this page", "current note", or similar.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
        },
      },
      {
        name: 'create_note',
        description: 'Create a new note in the vault. Use this when the user asks to create, write, or add a new note.',
        inputSchema: {
          type: 'object',
          properties: {
            folder: { type: 'string', description: 'The folder path where to create the note (use empty string for vault root)' },
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
    ];
  }

  /**
   * Execute a tool
   */
  private async executeTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    switch (name) {
      case 'search_vault':
        return this.toolSearchVault(args.query as string);

      case 'read_note':
        return this.toolReadNote(args.path as string);

      case 'get_current_page':
        return this.toolGetCurrentPage();

      case 'create_note':
        return this.toolCreateNote(
          args.folder as string,
          args.name as string,
          args.content as string
        );

      case 'append_to_note':
        return this.toolAppendToNote(args.path as string, args.content as string);

      case 'list_folder':
        return this.toolListFolder(args.path as string);

      case 'rename_file':
        return this.toolRenameFile(args.path as string, args.newName as string);

      case 'move_file':
        return this.toolMoveFile(args.sourcePath as string, args.targetFolder as string);

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  }

  // ============================================================================
  // Tool Implementations
  // ============================================================================

  private async toolSearchVault(query: string): Promise<ToolCallResult> {
    if (!query) {
      return {
        content: [{ type: 'text', text: 'Search query is required' }],
        isError: true,
      };
    }

    const results = await this.vaultSearch.searchFiles(query, 'vault', undefined);

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No files found matching "${query}"` }],
      };
    }

    const summary = results.slice(0, 5).map(r => {
      const matchSummary = r.matches.slice(0, 2).map(m =>
        `  - Line ${m.line}: ${m.content.slice(0, 100)}...`
      ).join('\n');
      return `- ${r.filePath}\n${matchSummary}`;
    }).join('\n\n');

    return {
      content: [{
        type: 'text',
        text: `Found ${results.length} file(s) matching "${query}":\n\n${summary}`,
      }],
    };
  }

  private async toolReadNote(path: string): Promise<ToolCallResult> {
    if (!path) {
      return {
        content: [{ type: 'text', text: 'Note path is required' }],
        isError: true,
      };
    }

    let normalizedPath = path;
    if (!normalizedPath.endsWith('.md')) {
      normalizedPath += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file || !(file instanceof TFile)) {
      return {
        content: [{ type: 'text', text: `Note not found: ${path}` }],
        isError: true,
      };
    }

    const content = await this.app.vault.read(file);
    const truncated = content.length > 8000
      ? content.slice(0, 8000) + '\n\n[Content truncated...]'
      : content;

    return {
      content: [{
        type: 'text',
        text: `Content of ${normalizedPath}:\n\n${truncated}`,
      }],
    };
  }

  private async toolGetCurrentPage(): Promise<ToolCallResult> {
    const activeFile = this.app.workspace.getActiveFile();

    if (!activeFile) {
      return {
        content: [{ type: 'text', text: 'No file is currently open in Obsidian.' }],
      };
    }

    const content = await this.app.vault.read(activeFile);
    const cache = this.app.metadataCache.getFileCache(activeFile);

    let response = `## Currently Open Page\n\n`;
    response += `**Path**: ${activeFile.path}\n`;
    response += `**Name**: ${activeFile.basename}\n`;

    if (cache?.frontmatter) {
      response += `**Frontmatter**: ${JSON.stringify(cache.frontmatter)}\n`;
    }

    // Get links
    if (cache?.links && cache.links.length > 0) {
      const links = cache.links.map(l => l.link).slice(0, 10);
      response += `**Outgoing links**: ${links.join(', ')}\n`;
    }

    response += `\n### Content\n\n`;

    const truncated = content.length > 8000
      ? content.slice(0, 8000) + '\n\n[Content truncated...]'
      : content;

    response += truncated;

    return {
      content: [{ type: 'text', text: response }],
    };
  }

  private async toolCreateNote(folder: string, name: string, content: string): Promise<ToolCallResult> {
    if (!name) {
      return {
        content: [{ type: 'text', text: 'Note name is required' }],
        isError: true,
      };
    }

    let folderPath = folder?.trim() || '';
    if (folderPath === '/' || folderPath === '.') {
      folderPath = '';
    }

    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const fullPath = folderPath ? `${folderPath}/${fileName}` : fileName;

    const existing = this.app.vault.getAbstractFileByPath(fullPath);
    if (existing) {
      return {
        content: [{
          type: 'text',
          text: `A note already exists at ${fullPath}. Use append_to_note to add content, or choose a different name.`,
        }],
        isError: true,
      };
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

    try {
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

      return {
        content: [{ type: 'text', text: `Successfully created note at ${fullPath}` }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to create note: ${error}` }],
        isError: true,
      };
    }
  }

  private async toolAppendToNote(path: string, content: string): Promise<ToolCallResult> {
    if (!path) {
      return {
        content: [{ type: 'text', text: 'Note path is required' }],
        isError: true,
      };
    }
    if (!content) {
      return {
        content: [{ type: 'text', text: 'Content to append is required' }],
        isError: true,
      };
    }

    let normalizedPath = path;
    if (!normalizedPath.endsWith('.md')) {
      normalizedPath += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file || !(file instanceof TFile)) {
      return {
        content: [{ type: 'text', text: `Note not found: ${path}` }],
        isError: true,
      };
    }

    try {
      const currentContent = await this.app.vault.read(file);
      const newContent = currentContent + '\n\n' + content;

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

      return {
        content: [{ type: 'text', text: `Successfully appended content to ${normalizedPath}` }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to append to note: ${error}` }],
        isError: true,
      };
    }
  }

  private async toolListFolder(path: string): Promise<ToolCallResult> {
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
      return {
        content: [{ type: 'text', text: `Folder not found: ${path}` }],
        isError: true,
      };
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
      return {
        content: [{ type: 'text', text: `Folder "${path || '/'}" is empty` }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: `Contents of "${path || '/'}":\n${items.join('\n')}`,
      }],
    };
  }

  private async toolRenameFile(path: string, newName: string): Promise<ToolCallResult> {
    if (!path) {
      return {
        content: [{ type: 'text', text: 'File path is required' }],
        isError: true,
      };
    }
    if (!newName) {
      return {
        content: [{ type: 'text', text: 'New name is required' }],
        isError: true,
      };
    }

    let normalizedPath = path;
    if (!normalizedPath.endsWith('.md')) {
      normalizedPath += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!file || !(file instanceof TFile)) {
      return {
        content: [{ type: 'text', text: `File not found: ${path}` }],
        isError: true,
      };
    }

    try {
      let normalizedNewName = newName;
      if (!normalizedNewName.endsWith('.md')) {
        normalizedNewName += '.md';
      }

      const folder = file.parent?.path || '';
      const newPath = folder ? `${folder}/${normalizedNewName}` : normalizedNewName;

      const existing = this.app.vault.getAbstractFileByPath(newPath);
      if (existing) {
        return {
          content: [{ type: 'text', text: `A file already exists at ${newPath}` }],
          isError: true,
        };
      }

      const undoOp = {
        id: `rename-file-${Date.now()}`,
        timestamp: Date.now(),
        description: `Renamed file: ${normalizedPath} → ${newPath}`,
        operations: [{ type: 'rename' as const, sourcePath: normalizedPath, targetPath: newPath }],
        reverseOperations: [{ type: 'rename' as const, sourcePath: newPath, targetPath: normalizedPath }],
      };

      await this.app.fileManager.renameFile(file, newPath);
      this.plugin.undoStack.push(undoOp);

      new Notice(`Renamed: ${file.name} → ${normalizedNewName}`);

      return {
        content: [{
          type: 'text',
          text: `Successfully renamed file from ${normalizedPath} to ${newPath}`,
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to rename file: ${error}` }],
        isError: true,
      };
    }
  }

  private async toolMoveFile(sourcePath: string, targetFolder: string): Promise<ToolCallResult> {
    if (!sourcePath) {
      return {
        content: [{ type: 'text', text: 'Source file path is required' }],
        isError: true,
      };
    }
    if (targetFolder === undefined) {
      return {
        content: [{ type: 'text', text: 'Target folder is required' }],
        isError: true,
      };
    }

    let normalizedSource = sourcePath;
    if (!normalizedSource.endsWith('.md')) {
      normalizedSource += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedSource);
    if (!file || !(file instanceof TFile)) {
      return {
        content: [{ type: 'text', text: `File not found: ${sourcePath}` }],
        isError: true,
      };
    }

    try {
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

      const newPath = normalizedTarget ? `${normalizedTarget}/${file.name}` : file.name;

      const existing = this.app.vault.getAbstractFileByPath(newPath);
      if (existing) {
        return {
          content: [{ type: 'text', text: `A file already exists at ${newPath}` }],
          isError: true,
        };
      }

      const undoOp = {
        id: `move-file-${Date.now()}`,
        timestamp: Date.now(),
        description: `Moved file: ${normalizedSource} → ${newPath}`,
        operations: [{ type: 'move' as const, sourcePath: normalizedSource, targetPath: newPath }],
        reverseOperations: [{ type: 'move' as const, sourcePath: newPath, targetPath: normalizedSource }],
      };

      await this.app.fileManager.renameFile(file, newPath);
      this.plugin.undoStack.push(undoOp);

      new Notice(`Moved: ${file.name} → ${targetFolder || '/'}`);

      return {
        content: [{
          type: 'text',
          text: `Successfully moved file from ${normalizedSource} to ${newPath}`,
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed to move file: ${error}` }],
        isError: true,
      };
    }
  }
}
