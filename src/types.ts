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
  enableAgentMode: boolean;
}

export const DEFAULT_SETTINGS: VaultAISettings = {
  serverType: 'ollama',
  serverUrl: 'http://localhost:11434',
  selectedModel: '',
  defaultContextScope: 'current',
  maxSearchIterations: 5,
  showThinkingProcess: true,
  enableAgentMode: true,
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
  reasoning?: string;
  agentSteps?: AgentStep[];
  actionsPerformed?: string[];
}

export interface AgentStep {
  type: 'tool_call' | 'final_answer';
  toolCall?: {
    tool: string;
    params: Record<string, any>;
    reasoning?: string;
  };
  toolResult?: {
    success: boolean;
    result: string;
    data?: any;
  };
  answer?: string;
  sources?: string[];
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
  lmStudioResponseId?: string;
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
// LMStudio New API v1 Types
// ============================================================================

export type LMStudioInputItem =
  | { type: 'message'; content: string }
  | { type: 'image'; data_url: string };

export interface LMStudioChatRequest {
  model: string;
  input: string | LMStudioInputItem[];
  system_prompt?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repeat_penalty?: number;
  max_output_tokens?: number;
  reasoning?: 'off' | 'low' | 'medium' | 'high' | 'on';
  context_length?: number;
  store?: boolean;
  previous_response_id?: string;
}

export interface LMStudioOutputItem {
  type: 'message' | 'tool_call' | 'reasoning' | 'invalid_tool_call';
  content?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  output?: string;
  reason?: string;
}

export interface LMStudioChatStats {
  input_tokens: number;
  total_output_tokens: number;
  reasoning_output_tokens: number;
  tokens_per_second: number;
  time_to_first_token_seconds: number;
  model_load_time_seconds?: number;
}

export interface LMStudioNewChatResponse {
  model_instance_id: string;
  output: LMStudioOutputItem[];
  stats: LMStudioChatStats;
  response_id?: string;
}

// Streaming event types
export type LMStudioStreamEventType =
  | 'chat.start'
  | 'model_load.start'
  | 'model_load.progress'
  | 'model_load.end'
  | 'prompt_processing.start'
  | 'prompt_processing.progress'
  | 'prompt_processing.end'
  | 'reasoning.start'
  | 'reasoning.delta'
  | 'reasoning.end'
  | 'tool_call.start'
  | 'tool_call.arguments'
  | 'tool_call.success'
  | 'tool_call.failure'
  | 'message.start'
  | 'message.delta'
  | 'message.end'
  | 'error'
  | 'chat.end';

export interface LMStudioStreamEvent {
  type: LMStudioStreamEventType;
  model_instance_id?: string;
  progress?: number;
  load_time_seconds?: number;
  content?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  output?: string;
  reason?: string;
  error?: {
    type: string;
    message: string;
    code?: string;
    param?: string;
  };
  result?: LMStudioNewChatResponse;
}

// Streaming callbacks
export interface LMStudioStreamCallbacks {
  onMessageDelta?: (content: string) => void;
  onReasoningDelta?: (content: string) => void;
  onReasoningStart?: () => void;
  onReasoningEnd?: () => void;
  onMessageStart?: () => void;
  onMessageEnd?: () => void;
  onModelLoadProgress?: (progress: number) => void;
  onPromptProcessingProgress?: (progress: number) => void;
  onError?: (error: { type: string; message: string }) => void;
  onChatEnd?: (result: LMStudioNewChatResponse) => void;
}

// ============================================================================
// UI
// ============================================================================

export type TabType = 'chat' | 'format' | 'structure';

export interface TabState {
  activeTab: TabType;
}
