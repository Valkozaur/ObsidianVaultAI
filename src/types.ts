// ============================================================================
// Settings
// ============================================================================

export type ServerType = 'ollama' | 'lmstudio';
export type ContextScope = 'current' | 'linked' | 'folder' | 'vault';
export type ConnectionStatus = 'ready' | 'thinking' | 'offline';

export interface VaultAISettings {
  serverType: ServerType;
  serverUrl: string;
  selectedModel: string;
  defaultContextScope: ContextScope;
  maxSearchIterations: number;
  showThinkingProcess: boolean;
}

export const DEFAULT_SETTINGS: VaultAISettings = {
  serverType: 'ollama',
  serverUrl: 'http://localhost:11434',
  selectedModel: '',
  defaultContextScope: 'current',
  maxSearchIterations: 5,
  showThinkingProcess: true,
};

export const DEFAULT_URLS: Record<ServerType, string> = {
  ollama: 'http://localhost:11434',
  lmstudio: 'http://localhost:1234',
};

// ============================================================================
// Chat
// ============================================================================

export type MessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: MessageRole;
  content: string;
  timestamp: number;
  sources?: string[];
  searchSteps?: SearchStep[];
}

export interface SearchStep {
  iteration: number;
  action: string;
  query?: string;
  results?: SearchResult[];
  reasoning: string;
}

// ============================================================================
// Chat History
// ============================================================================

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  contextScope: ContextScope;
  createdAt: number;
  updatedAt: number;
}

export interface ChatHistory {
  conversations: Conversation[];
  activeConversationId: string | null;
}

export interface SearchResult {
  filePath: string;
  fileName: string;
  matches: SearchMatch[];
}

export interface SearchMatch {
  line: number;
  content: string;
  context: string;
}

export interface AgenticSearchResult {
  answer: string;
  sources: string[];
  steps: SearchStep[];
}

// ============================================================================
// Format
// ============================================================================

export interface FormatSuggestion {
  id: string;
  description: string;
  category: FormatCategory;
  before: string;
  after: string;
  lineStart: number;
  lineEnd: number;
  applied?: boolean;
}

export type FormatCategory =
  | 'heading'
  | 'list'
  | 'frontmatter'
  | 'whitespace'
  | 'code-block'
  | 'link'
  | 'other';

export interface FormatAnalysisResult {
  suggestions: FormatSuggestion[];
  summary: string;
}

// ============================================================================
// Structure
// ============================================================================

export interface StructureSuggestion {
  id: string;
  type: StructureOperationType;
  description: string;
  reasoning: string;
  affectedFiles: string[];
  operations: FileOperation[];
  executed?: boolean;
}

export type StructureOperationType =
  | 'create-folder'
  | 'move'
  | 'rename'
  | 'merge'
  | 'tag'
  | 'archive';

export interface StructureAnalysisResult {
  suggestions: StructureSuggestion[];
  summary: string;
}

// ============================================================================
// File Operations
// ============================================================================

export interface FileOperation {
  type: FileOperationType;
  sourcePath: string;
  targetPath?: string;
  content?: string;
}

export type FileOperationType =
  | 'create-folder'
  | 'create-file'
  | 'move'
  | 'rename'
  | 'delete'
  | 'modify';

export interface UndoableOperation {
  id: string;
  timestamp: number;
  description: string;
  operations: FileOperation[];
  reverseOperations: FileOperation[];
}

// ============================================================================
// LLM
// ============================================================================

export interface LLMMessage {
  role: MessageRole;
  content: string;
}

export interface OllamaTagsResponse {
  models: OllamaModel[];
}

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export interface LMStudioModelsResponse {
  object: string;
  data: LMStudioModel[];
}

export interface LMStudioModel {
  id: string;
  object: string;
  owned_by: string;
}

export interface LMStudioChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ============================================================================
// UI
// ============================================================================

export type TabType = 'chat' | 'format' | 'structure';

export interface TabState {
  activeTab: TabType;
}
