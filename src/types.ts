// ============================================================================
// Settings
// ============================================================================

export type ServerType = 'ollama' | 'lmstudio';
export type ContextScope = 'current' | 'linked' | 'folder' | 'vault';
export type ConnectionStatus = 'ready' | 'thinking' | 'offline';

// MCP Server configuration for settings
export interface MCPServerConfig {
  label: string;
  url: string;
  allowedTools?: string[];
}

export interface VaultAISettings {
  serverType: ServerType;
  serverUrl: string;
  selectedModel: string;
  defaultContextScope: ContextScope;
  maxSearchIterations: number;
  showThinkingProcess: boolean;
  enableAgentMode: boolean;
  // LMStudio-specific settings
  lmStudioContextLength: number;
  lmStudioReasoning: 'off' | 'low' | 'medium' | 'high' | 'on' | 'auto';
  // MCP integration settings
  mcpServers: MCPServerConfig[];
  mcpPlugins: string[]; // Plugin IDs for LM Studio's built-in MCP plugins
}

export const DEFAULT_SETTINGS: VaultAISettings = {
  serverType: 'ollama',
  serverUrl: 'http://localhost:11434',
  selectedModel: '',
  defaultContextScope: 'current',
  maxSearchIterations: 5,
  showThinkingProcess: true,
  enableAgentMode: true,
  // LMStudio defaults
  lmStudioContextLength: 8000,
  lmStudioReasoning: 'auto',
  // MCP defaults
  mcpServers: [],
  mcpPlugins: [],
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

// MCP Integration Types
export interface LMStudioPluginIntegration {
  type: 'plugin';
  id: string;
  allowed_tools?: string[];
}

export interface LMStudioEphemeralMCPIntegration {
  type: 'ephemeral_mcp';
  server_label: string;
  server_url: string;
  allowed_tools?: string[];
  headers?: Record<string, string>;
}

export type LMStudioIntegration =
  | string // Shorthand for plugin id
  | LMStudioPluginIntegration
  | LMStudioEphemeralMCPIntegration;

// Tool Provider Info
export interface LMStudioToolProviderInfo {
  type: 'plugin' | 'ephemeral_mcp';
  plugin_id?: string;
  server_label?: string;
}

export interface LMStudioChatRequest {
  model: string;
  input: string | LMStudioInputItem[];
  system_prompt?: string;
  integrations?: LMStudioIntegration[];
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

// Output item for message
export interface LMStudioMessageOutput {
  type: 'message';
  content: string;
}

// Output item for tool call
export interface LMStudioToolCallOutput {
  type: 'tool_call';
  tool: string;
  arguments: Record<string, unknown>;
  output: string;
  provider_info: LMStudioToolProviderInfo;
}

// Output item for reasoning
export interface LMStudioReasoningOutput {
  type: 'reasoning';
  content: string;
}

// Output item for invalid tool call
export interface LMStudioInvalidToolCallOutput {
  type: 'invalid_tool_call';
  reason: string;
  metadata: {
    type: 'invalid_name' | 'invalid_arguments';
    tool_name: string;
    arguments?: Record<string, unknown>;
    provider_info?: LMStudioToolProviderInfo;
  };
}

export type LMStudioOutputItem =
  | LMStudioMessageOutput
  | LMStudioToolCallOutput
  | LMStudioReasoningOutput
  | LMStudioInvalidToolCallOutput;

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
  | 'tool_call.output'
  | 'tool_call.success'
  | 'tool_call.failure'
  | 'message.start'
  | 'message.delta'
  | 'message.end'
  | 'error'
  | 'chat.end';

// Tool call info for streaming
export interface LMStudioToolCallInfo {
  tool: string;
  arguments: Record<string, unknown>;
  provider_info?: LMStudioToolProviderInfo;
}

export interface LMStudioStreamEvent {
  type: LMStudioStreamEventType;
  model_instance_id?: string;
  progress?: number;
  load_time_seconds?: number;
  content?: string;
  // Tool call related fields
  tool?: string;
  arguments?: Record<string, unknown>;
  output?: string;
  reason?: string;
  provider_info?: LMStudioToolProviderInfo;
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
  // Tool call callbacks
  onToolCallStart?: (toolInfo: LMStudioToolCallInfo) => void;
  onToolCallArguments?: (args: Record<string, unknown>) => void;
  onToolCallOutput?: (output: string) => void;
  onToolCallSuccess?: (result: LMStudioToolCallOutput) => void;
  onToolCallFailure?: (reason: string, toolInfo?: LMStudioToolCallInfo) => void;
  onError?: (error: { type: string; message: string }) => void;
  onChatEnd?: (result: LMStudioNewChatResponse) => void;
}

// ============================================================================
// UI
// ============================================================================

// Note: Format and Structure tabs have been integrated as agent tools
// TabType kept for backward compatibility but only 'chat' is used
export type TabType = 'chat';
