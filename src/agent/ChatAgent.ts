import { App, TFile, TFolder, Notice } from 'obsidian';
import type VaultAIPlugin from '../main';
import { VaultSearch } from '../search/VaultSearch';
import { FileOperations } from '../operations/FileOperations';
import { LLMMessage, ContextScope, FormatSuggestion, FileOperation } from '../types';
import { AGENT_SYSTEM_PROMPT } from '../prompts/agent';
import { FORMAT_SYSTEM_PROMPT, buildFormatPrompt } from '../prompts/format';
import { STRUCTURE_SYSTEM_PROMPT, buildStructurePrompt } from '../prompts/structure';

// Tool definitions
export interface Tool {
  name: string;
  description: string;
  parameters: {
    name: string;
    type: string;
    description: string;
    required: boolean;
  }[];
}

export interface ToolCall {
  tool: string;
  params: Record<string, any>;
  reasoning?: string;
}

export interface ToolResult {
  success: boolean;
  result: string;
  data?: any;
}

export interface AgentStep {
  type: 'tool_call' | 'final_answer';
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  answer?: string;
  sources?: string[];
}

export interface AgentResult {
  answer: string;
  sources: string[];
  steps: AgentStep[];
  actionsPerformed: string[];
}

export const AVAILABLE_TOOLS: Tool[] = [
  {
    name: 'search_vault',
    description: 'Search for notes in the vault containing specific terms. Returns file paths and matching excerpts.',
    parameters: [
      { name: 'query', type: 'string', description: 'The search query', required: true },
    ],
  },
  {
    name: 'read_note',
    description: 'Read the full content of a specific note. Use this to get more details from a note found in search results.',
    parameters: [
      { name: 'path', type: 'string', description: 'The path to the note (e.g., "folder/note.md")', required: true },
    ],
  },
  {
    name: 'create_note',
    description: 'Create a new note in the vault. Use this when the user asks to create, write, or add a new note.',
    parameters: [
      { name: 'folder', type: 'string', description: 'The folder path where to create the note (e.g., "Projects" or "Daily Notes"). Use empty string for vault root.', required: true },
      { name: 'name', type: 'string', description: 'The name of the note (without .md extension)', required: true },
      { name: 'content', type: 'string', description: 'The markdown content of the note', required: true },
    ],
  },
  {
    name: 'append_to_note',
    description: 'Append content to an existing note. Use this to add information to an existing note.',
    parameters: [
      { name: 'path', type: 'string', description: 'The path to the note (e.g., "folder/note.md")', required: true },
      { name: 'content', type: 'string', description: 'The content to append', required: true },
    ],
  },
  {
    name: 'list_folder',
    description: 'List all files and subfolders in a folder. Use "/" for vault root.',
    parameters: [
      { name: 'path', type: 'string', description: 'The folder path to list', required: true },
    ],
  },
  {
    name: 'format_note',
    description: 'Analyze and apply formatting improvements to a note. Returns formatting suggestions and can automatically apply them.',
    parameters: [
      { name: 'path', type: 'string', description: 'The path to the note to format (e.g., "folder/note.md")', required: true },
      { name: 'apply', type: 'boolean', description: 'Whether to automatically apply the formatting suggestions (default: false)', required: false },
      { name: 'instructions', type: 'string', description: 'Optional custom instructions for formatting (e.g., "Focus on headings")', required: false },
    ],
  },
  {
    name: 'suggest_restructure',
    description: 'Analyze vault or folder structure and suggest reorganization improvements like moving files, creating folders, or renaming for better organization.',
    parameters: [
      { name: 'folder', type: 'string', description: 'The folder to analyze (use "/" for entire vault)', required: true },
    ],
  },
  {
    name: 'rename_file',
    description: 'Rename a file in the vault.',
    parameters: [
      { name: 'path', type: 'string', description: 'Current path to the file (e.g., "folder/old-name.md")', required: true },
      { name: 'newName', type: 'string', description: 'New name for the file (without path, e.g., "new-name.md")', required: true },
    ],
  },
  {
    name: 'rename_folder',
    description: 'Rename a folder in the vault.',
    parameters: [
      { name: 'path', type: 'string', description: 'Current path to the folder (e.g., "old-folder-name")', required: true },
      { name: 'newName', type: 'string', description: 'New name for the folder (without path)', required: true },
    ],
  },
  {
    name: 'move_file',
    description: 'Move a file to a different folder in the vault.',
    parameters: [
      { name: 'sourcePath', type: 'string', description: 'Current path to the file (e.g., "folder/note.md")', required: true },
      { name: 'targetFolder', type: 'string', description: 'Target folder path (e.g., "new-folder" or "/" for root)', required: true },
    ],
  },
  {
    name: 'final_answer',
    description: 'Provide the final answer to the user. Always use this when you have gathered enough information or completed the requested action.',
    parameters: [
      { name: 'answer', type: 'string', description: 'Your final answer to the user', required: true },
      { name: 'sources', type: 'array', description: 'List of source file paths referenced in the answer', required: false },
    ],
  },
];

export class ChatAgent {
  private plugin: VaultAIPlugin;
  private app: App;
  private vaultSearch: VaultSearch;
  private fileOperations: FileOperations;
  private maxIterations: number;

  constructor(plugin: VaultAIPlugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.vaultSearch = new VaultSearch(plugin.app);
    this.fileOperations = new FileOperations(plugin.app);
    this.maxIterations = plugin.settings.maxSearchIterations || 5;
  }

  async execute(
    userQuery: string,
    scope: ContextScope,
    conversationHistory: LLMMessage[] = []
  ): Promise<AgentResult> {
    const steps: AgentStep[] = [];
    const actionsPerformed: string[] = [];
    let finalAnswer = '';
    let finalSources: string[] = [];
    let iteration = 0;

    // Build the initial messages
    const messages: LLMMessage[] = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      ...conversationHistory,
      { role: 'user', content: this.buildUserPrompt(userQuery, scope) },
    ];

    console.log('[ChatAgent] Starting agent execution for:', userQuery);

    while (iteration < this.maxIterations) {
      iteration++;
      console.log(`[ChatAgent] Iteration ${iteration}`);

      try {
        // Get LLM response
        const response = await this.plugin.llmClient?.chat(messages);
        if (!response) {
          throw new Error('No response from LLM');
        }

        console.log('[ChatAgent] LLM response:', response.slice(0, 200));

        // Parse tool call from response
        const toolCall = this.parseToolCall(response);

        if (!toolCall) {
          // No tool call found, treat as direct answer
          console.log('[ChatAgent] No tool call found, treating as final answer');
          finalAnswer = response;
          break;
        }

        console.log('[ChatAgent] Tool call:', toolCall.tool, toolCall.params);

        // Handle final_answer tool
        if (toolCall.tool === 'final_answer') {
          finalAnswer = toolCall.params.answer || response;
          finalSources = toolCall.params.sources || [];
          steps.push({
            type: 'final_answer',
            answer: finalAnswer,
            sources: finalSources,
          });
          break;
        }

        // Execute the tool
        const toolResult = await this.executeTool(toolCall);

        steps.push({
          type: 'tool_call',
          toolCall,
          toolResult,
        });

        // Track actions performed (for create, append, etc.)
        if (toolCall.tool === 'create_note' && toolResult.success) {
          actionsPerformed.push(`Created note: ${toolCall.params.folder}/${toolCall.params.name}.md`);
        } else if (toolCall.tool === 'append_to_note' && toolResult.success) {
          actionsPerformed.push(`Appended content to: ${toolCall.params.path}`);
        }

        // Add the assistant's response and tool result to messages
        messages.push({ role: 'assistant', content: response });
        messages.push({
          role: 'user',
          content: `Tool result for ${toolCall.tool}:\n${toolResult.result}`,
        });

      } catch (error) {
        console.error('[ChatAgent] Error in iteration:', error);
        finalAnswer = `I encountered an error: ${error}. Please try again.`;
        break;
      }
    }

    if (!finalAnswer && iteration >= this.maxIterations) {
      finalAnswer = 'I reached the maximum number of iterations without completing the task. Please try rephrasing your request.';
    }

    return {
      answer: finalAnswer,
      sources: finalSources,
      steps,
      actionsPerformed,
    };
  }

  private buildUserPrompt(query: string, scope: ContextScope): string {
    const scopeDescription: Record<ContextScope, string> = {
      current: 'the currently open note only',
      linked: 'the current note and all notes linked to/from it',
      folder: 'all notes in the current folder',
      vault: 'the entire vault',
    };

    const currentFile = this.app.workspace.getActiveFile();
    const currentPath = currentFile?.path || 'No file currently open';

    return `User request: "${query}"

Current context:
- Current file: ${currentPath}
- Search scope: ${scopeDescription[scope]}

Please help the user with their request. Use the available tools to search, read, create, or modify notes as needed. When done, use the final_answer tool to provide your response.`;
  }

  private parseToolCall(response: string): ToolCall | null {
    // Try to find JSON block in the response
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        if (parsed.tool && typeof parsed.tool === 'string') {
          return {
            tool: parsed.tool,
            params: parsed.params || {},
            reasoning: parsed.reasoning,
          };
        }
      } catch (e) {
        console.log('[ChatAgent] Failed to parse JSON block:', e);
      }
    }

    // Try to find inline JSON
    const inlineMatch = response.match(/\{[\s\S]*?"tool"\s*:\s*"[^"]+"/);
    if (inlineMatch) {
      // Find the complete JSON object
      const startIndex = response.indexOf(inlineMatch[0]);
      let braceCount = 0;
      let endIndex = startIndex;

      for (let i = startIndex; i < response.length; i++) {
        if (response[i] === '{') braceCount++;
        if (response[i] === '}') braceCount--;
        if (braceCount === 0) {
          endIndex = i + 1;
          break;
        }
      }

      try {
        const jsonStr = response.slice(startIndex, endIndex);
        const parsed = JSON.parse(jsonStr);
        if (parsed.tool && typeof parsed.tool === 'string') {
          return {
            tool: parsed.tool,
            params: parsed.params || {},
            reasoning: parsed.reasoning,
          };
        }
      } catch (e) {
        console.log('[ChatAgent] Failed to parse inline JSON:', e);
      }
    }

    return null;
  }

  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    const { tool, params } = toolCall;

    try {
      switch (tool) {
        case 'search_vault':
          return await this.toolSearchVault(params.query);

        case 'read_note':
          return await this.toolReadNote(params.path);

        case 'create_note':
          return await this.toolCreateNote(params.folder, params.name, params.content);

        case 'append_to_note':
          return await this.toolAppendToNote(params.path, params.content);

        case 'list_folder':
          return await this.toolListFolder(params.path);

        case 'format_note':
          return await this.toolFormatNote(params.path, params.apply, params.instructions);

        case 'suggest_restructure':
          return await this.toolSuggestRestructure(params.folder);

        case 'rename_file':
          return await this.toolRenameFile(params.path, params.newName);

        case 'rename_folder':
          return await this.toolRenameFolder(params.path, params.newName);

        case 'move_file':
          return await this.toolMoveFile(params.sourcePath, params.targetFolder);

        default:
          return {
            success: false,
            result: `Unknown tool: ${tool}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        result: `Error executing tool ${tool}: ${error}`,
      };
    }
  }

  private async toolSearchVault(query: string): Promise<ToolResult> {
    if (!query) {
      return { success: false, result: 'Search query is required' };
    }

    const results = await this.vaultSearch.searchFiles(query, 'vault', undefined);

    if (results.length === 0) {
      return {
        success: true,
        result: `No files found matching "${query}"`,
        data: [],
      };
    }

    const summary = results.slice(0, 5).map(r => {
      const matchSummary = r.matches.slice(0, 2).map(m =>
        `  - Line ${m.line}: ${m.content.slice(0, 100)}...`
      ).join('\n');
      return `- ${r.filePath}\n${matchSummary}`;
    }).join('\n\n');

    return {
      success: true,
      result: `Found ${results.length} file(s) matching "${query}":\n\n${summary}`,
      data: results,
    };
  }

  private async toolReadNote(path: string): Promise<ToolResult> {
    if (!path) {
      return { success: false, result: 'Note path is required' };
    }

    // Normalize path
    let normalizedPath = path;
    if (!normalizedPath.endsWith('.md')) {
      normalizedPath += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file) {
      // Try without .md if it was added
      const altPath = path.endsWith('.md') ? path.slice(0, -3) : path;
      const altFile = this.app.vault.getAbstractFileByPath(altPath);
      if (!altFile) {
        return { success: false, result: `Note not found: ${path}` };
      }
    }

    if (!(file instanceof TFile)) {
      return { success: false, result: `Path is not a file: ${path}` };
    }

    const content = await this.app.vault.read(file);
    const truncated = content.length > 3000
      ? content.slice(0, 3000) + '\n\n[Content truncated...]'
      : content;

    return {
      success: true,
      result: `Content of ${normalizedPath}:\n\n${truncated}`,
      data: { path: normalizedPath, content },
    };
  }

  private async toolCreateNote(folder: string, name: string, content: string): Promise<ToolResult> {
    if (!name) {
      return { success: false, result: 'Note name is required' };
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
      return {
        success: false,
        result: `A note already exists at ${fullPath}. Use append_to_note to add content to it, or choose a different name.`,
      };
    }

    // Ensure folder exists
    if (folderPath) {
      const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
      if (!folderExists) {
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
      }
    }

    // Create the note
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
        success: true,
        result: `Successfully created note at ${fullPath}`,
        data: { path: fullPath },
      };
    } catch (error) {
      return {
        success: false,
        result: `Failed to create note: ${error}`,
      };
    }
  }

  private async toolAppendToNote(path: string, content: string): Promise<ToolResult> {
    if (!path) {
      return { success: false, result: 'Note path is required' };
    }
    if (!content) {
      return { success: false, result: 'Content to append is required' };
    }

    // Normalize path
    let normalizedPath = path;
    if (!normalizedPath.endsWith('.md')) {
      normalizedPath += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file || !(file instanceof TFile)) {
      return { success: false, result: `Note not found: ${path}` };
    }

    try {
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

      return {
        success: true,
        result: `Successfully appended content to ${normalizedPath}`,
        data: { path: normalizedPath },
      };
    } catch (error) {
      return {
        success: false,
        result: `Failed to append to note: ${error}`,
      };
    }
  }

  private async toolListFolder(path: string): Promise<ToolResult> {
    let folderPath = path?.trim() || '/';
    if (folderPath === '/') {
      folderPath = '';
    }

    let folder: TFolder | null = null;

    if (!folderPath) {
      // Root folder
      folder = this.app.vault.getRoot();
    } else {
      const abstractFile = this.app.vault.getAbstractFileByPath(folderPath);
      if (abstractFile instanceof TFolder) {
        folder = abstractFile;
      }
    }

    if (!folder) {
      return { success: false, result: `Folder not found: ${path}` };
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
        success: true,
        result: `Folder "${path || '/'}" is empty`,
        data: [],
      };
    }

    return {
      success: true,
      result: `Contents of "${path || '/'}":\n${items.join('\n')}`,
      data: items,
    };
  }

  private async toolFormatNote(
    path: string,
    apply: boolean = false,
    instructions?: string
  ): Promise<ToolResult> {
    if (!path) {
      return { success: false, result: 'Note path is required' };
    }

    // Normalize path
    let normalizedPath = path;
    if (!normalizedPath.endsWith('.md')) {
      normalizedPath += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!file || !(file instanceof TFile)) {
      return { success: false, result: `Note not found: ${path}` };
    }

    try {
      const content = await this.app.vault.read(file);

      // Build prompt for formatting analysis
      const messages: LLMMessage[] = [
        { role: 'system', content: FORMAT_SYSTEM_PROMPT },
        { role: 'user', content: buildFormatPrompt(content, instructions || '') },
      ];

      const response = await this.plugin.llmClient?.chat(messages);
      if (!response) {
        return { success: false, result: 'Failed to get formatting suggestions from LLM' };
      }

      // Parse suggestions
      const suggestions = this.parseFormatResponse(response);

      if (suggestions.length === 0) {
        return {
          success: true,
          result: `No formatting improvements needed for ${normalizedPath}. The note is already well-formatted.`,
        };
      }

      // Apply suggestions if requested
      if (apply) {
        let modifiedContent = content;
        let appliedCount = 0;

        for (const suggestion of suggestions) {
          if (suggestion.before && suggestion.after !== undefined) {
            const newContent = modifiedContent.replace(suggestion.before, suggestion.after);
            if (newContent !== modifiedContent) {
              modifiedContent = newContent;
              appliedCount++;
            }
          }
        }

        if (appliedCount > 0) {
          // Store for undo
          const undoOp = {
            id: `format-${Date.now()}`,
            timestamp: Date.now(),
            description: `Formatted note: ${normalizedPath}`,
            operations: [{ type: 'modify' as const, sourcePath: normalizedPath, content: modifiedContent }],
            reverseOperations: [{ type: 'modify' as const, sourcePath: normalizedPath, content }],
          };

          await this.app.vault.modify(file, modifiedContent);
          this.plugin.undoStack.push(undoOp);

          new Notice(`Applied ${appliedCount} formatting change(s) to ${normalizedPath}`);

          return {
            success: true,
            result: `Applied ${appliedCount} formatting improvement(s) to ${normalizedPath}:\n${suggestions.map(s => `- ${s.description}`).join('\n')}`,
            data: { path: normalizedPath, appliedCount },
          };
        }
      }

      // Return suggestions without applying
      const suggestionList = suggestions.map(s => `- [${s.category}] ${s.description}`).join('\n');
      return {
        success: true,
        result: `Found ${suggestions.length} formatting suggestion(s) for ${normalizedPath}:\n${suggestionList}\n\nUse apply=true to automatically apply these changes.`,
        data: { path: normalizedPath, suggestions },
      };
    } catch (error) {
      return { success: false, result: `Failed to format note: ${error}` };
    }
  }

  private parseFormatResponse(response: string): FormatSuggestion[] {
    try {
      const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;
      const data = JSON.parse(jsonStr);

      const suggestions = Array.isArray(data) ? data : (data.suggestions || []);
      return suggestions.map((s: any, i: number) => ({
        id: `suggestion-${i}`,
        description: s.description || 'Formatting improvement',
        category: s.category || 'other',
        before: s.before || '',
        after: s.after || '',
        lineStart: s.lineStart || 0,
        lineEnd: s.lineEnd || 0,
        applied: false,
      }));
    } catch (error) {
      console.error('Failed to parse format response:', error);
      return [];
    }
  }

  private async toolSuggestRestructure(folder: string): Promise<ToolResult> {
    const basePath = folder === '/' ? '' : (folder || '');

    try {
      // Get file structure info
      const files = this.app.vault.getMarkdownFiles();
      const relevantFiles = files.filter(f => {
        if (basePath === '') return true;
        return f.path.startsWith(basePath);
      });

      const fileList = relevantFiles.map(f => {
        const cache = this.app.metadataCache.getFileCache(f);
        const tags = cache?.tags?.map(t => t.tag).join(', ') || '';
        const frontmatterTags = cache?.frontmatter?.tags || [];
        const allTags = tags || (Array.isArray(frontmatterTags) ? frontmatterTags.join(', ') : frontmatterTags);
        return `- ${f.path}${allTags ? ` [tags: ${allTags}]` : ''}`;
      }).join('\n');

      if (!fileList) {
        return {
          success: true,
          result: `No files found in ${folder === '/' ? 'vault' : folder} to analyze.`,
        };
      }

      // Build prompt for structure analysis
      const messages: LLMMessage[] = [
        { role: 'system', content: STRUCTURE_SYSTEM_PROMPT },
        { role: 'user', content: buildStructurePrompt(fileList, folder) },
      ];

      const response = await this.plugin.llmClient?.chat(messages);
      if (!response) {
        return { success: false, result: 'Failed to get restructure suggestions from LLM' };
      }

      // Parse suggestions
      const suggestions = this.parseStructureResponse(response);

      if (suggestions.length === 0) {
        return {
          success: true,
          result: `No restructuring suggestions for ${folder === '/' ? 'the vault' : folder}. The organization looks good.`,
        };
      }

      const suggestionList = suggestions.map((s, i) =>
        `${i + 1}. [${s.type}] ${s.description}\n   Reason: ${s.reasoning}\n   Files affected: ${s.affectedFiles.join(', ') || 'none'}`
      ).join('\n\n');

      return {
        success: true,
        result: `Found ${suggestions.length} restructuring suggestion(s) for ${folder === '/' ? 'the vault' : folder}:\n\n${suggestionList}\n\nYou can use rename_file, rename_folder, move_file, or create_note tools to implement these suggestions.`,
        data: { folder, suggestions },
      };
    } catch (error) {
      return { success: false, result: `Failed to analyze structure: ${error}` };
    }
  }

  private parseStructureResponse(response: string): Array<{
    type: string;
    description: string;
    reasoning: string;
    affectedFiles: string[];
    operations: FileOperation[];
  }> {
    try {
      const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;
      const data = JSON.parse(jsonStr);

      const suggestions = Array.isArray(data) ? data : (data.suggestions || []);
      return suggestions.map((s: any) => ({
        type: s.type || 'move',
        description: s.description || 'Reorganization',
        reasoning: s.reasoning || '',
        affectedFiles: s.affectedFiles || [],
        operations: s.operations || [],
      }));
    } catch (error) {
      console.error('Failed to parse structure response:', error);
      return [];
    }
  }

  private async toolRenameFile(path: string, newName: string): Promise<ToolResult> {
    if (!path) {
      return { success: false, result: 'File path is required' };
    }
    if (!newName) {
      return { success: false, result: 'New name is required' };
    }

    // Normalize path
    let normalizedPath = path;
    if (!normalizedPath.endsWith('.md')) {
      normalizedPath += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!file || !(file instanceof TFile)) {
      return { success: false, result: `File not found: ${path}` };
    }

    try {
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
        return { success: false, result: `A file already exists at ${newPath}` };
      }

      // Store for undo
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
        success: true,
        result: `Successfully renamed file from ${normalizedPath} to ${newPath}`,
        data: { oldPath: normalizedPath, newPath },
      };
    } catch (error) {
      return { success: false, result: `Failed to rename file: ${error}` };
    }
  }

  private async toolRenameFolder(path: string, newName: string): Promise<ToolResult> {
    if (!path) {
      return { success: false, result: 'Folder path is required' };
    }
    if (!newName) {
      return { success: false, result: 'New name is required' };
    }

    const folder = this.app.vault.getAbstractFileByPath(path);
    if (!folder || !(folder instanceof TFolder)) {
      return { success: false, result: `Folder not found: ${path}` };
    }

    try {
      // Build new path
      const parent = folder.parent?.path || '';
      const newPath = parent ? `${parent}/${newName}` : newName;

      // Check if target exists
      const existing = this.app.vault.getAbstractFileByPath(newPath);
      if (existing) {
        return { success: false, result: `A folder already exists at ${newPath}` };
      }

      // Store for undo
      const undoOp = {
        id: `rename-folder-${Date.now()}`,
        timestamp: Date.now(),
        description: `Renamed folder: ${path} → ${newPath}`,
        operations: [{ type: 'rename' as const, sourcePath: path, targetPath: newPath }],
        reverseOperations: [{ type: 'rename' as const, sourcePath: newPath, targetPath: path }],
      };

      await this.app.fileManager.renameFile(folder, newPath);
      this.plugin.undoStack.push(undoOp);

      new Notice(`Renamed folder: ${folder.name} → ${newName}`);

      return {
        success: true,
        result: `Successfully renamed folder from ${path} to ${newPath}`,
        data: { oldPath: path, newPath },
      };
    } catch (error) {
      return { success: false, result: `Failed to rename folder: ${error}` };
    }
  }

  private async toolMoveFile(sourcePath: string, targetFolder: string): Promise<ToolResult> {
    if (!sourcePath) {
      return { success: false, result: 'Source file path is required' };
    }
    if (targetFolder === undefined) {
      return { success: false, result: 'Target folder is required' };
    }

    // Normalize source path
    let normalizedSource = sourcePath;
    if (!normalizedSource.endsWith('.md')) {
      normalizedSource += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedSource);
    if (!file || !(file instanceof TFile)) {
      return { success: false, result: `File not found: ${sourcePath}` };
    }

    try {
      // Normalize target folder
      let normalizedTarget = targetFolder.trim();
      if (normalizedTarget === '/') {
        normalizedTarget = '';
      }

      // Ensure target folder exists
      if (normalizedTarget) {
        const targetFolderFile = this.app.vault.getAbstractFileByPath(normalizedTarget);
        if (!targetFolderFile) {
          // Create folder hierarchy
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
        return { success: false, result: `A file already exists at ${newPath}` };
      }

      // Store for undo
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
        success: true,
        result: `Successfully moved file from ${normalizedSource} to ${newPath}`,
        data: { oldPath: normalizedSource, newPath },
      };
    } catch (error) {
      return { success: false, result: `Failed to move file: ${error}` };
    }
  }
}
