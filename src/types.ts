// ============================================================================
// Settings
// ============================================================================

export type ContextScope = 'current' | 'linked' | 'folder' | 'vault';
export type ConnectionStatus = 'ready' | 'thinking' | 'offline';

export type ReasoningLevel = 'auto' | 'off' | 'low' | 'medium' | 'high' | 'on';

export interface VaultAISettings {
  serverUrl: string;
  selectedModel: string;
  showThinkingProcess: boolean;
  mcpEnabled: boolean;
  mcpPort: number;
  systemPrompt: string;
  reasoning: ReasoningLevel;
  modelContextLength: number;
  modelFlashAttention: boolean;
}

export const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to the user's Obsidian vault through MCP tools.
You can search, read, create, edit, and manage notes in their vault.

When helping the user:
- Be concise and direct in your responses
- Use the available tools to interact with their vault when needed
- Mention which notes you found or modified
- If you can't find relevant information, say so honestly`;

export const DEFAULT_SETTINGS: VaultAISettings = {
  serverUrl: 'http://localhost:1234',
  selectedModel: '',
  showThinkingProcess: true,
  mcpEnabled: true,
  mcpPort: 3456,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  reasoning: 'auto',
  modelContextLength: 16384,
  modelFlashAttention: true,
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
  toolCalls?: ToolCallInfo[];
}

export interface ToolCallInfo {
  tool: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'failure';
  result?: string;
  error?: string;
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

export interface LMStudioModelsResponse {
  object: string;
  data: LMStudioModel[];
}

export interface LMStudioModel {
  id: string;
  object: string;
  owned_by: string;
}

// ============================================================================
// LMStudio Model Management API Types (GET /api/v1/models)
// ============================================================================

export interface LMStudioModelQuantization {
  name: string | null;
  bits_per_weight: number | null;
}

export interface LMStudioModelLoadConfig {
  context_length: number;
  eval_batch_size?: number;
  flash_attention?: boolean;
  num_experts?: number;
  offload_kv_cache_to_gpu?: boolean;
}

export interface LMStudioModelInstance {
  id: string;
  config: LMStudioModelLoadConfig;
}

export interface LMStudioModelCapabilities {
  vision: boolean;
  trained_for_tool_use: boolean;
}

export interface LMStudioModelInfo {
  type: 'llm' | 'embedding';
  publisher: string;
  key: string;
  display_name: string;
  architecture?: string | null;
  quantization: LMStudioModelQuantization | null;
  size_bytes: number;
  params_string: string | null;
  loaded_instances: LMStudioModelInstance[];
  max_context_length: number;
  format: 'gguf' | 'mlx' | null;
  capabilities?: LMStudioModelCapabilities;
  description?: string | null;
}

export interface LMStudioModelsV1Response {
  models: LMStudioModelInfo[];
}

export interface LMStudioLoadModelRequest {
  model: string;
  context_length?: number;
  eval_batch_size?: number;
  flash_attention?: boolean;
  num_experts?: number;
  offload_kv_cache_to_gpu?: boolean;
  echo_load_config?: boolean;
}

export interface LMStudioLoadModelResponse {
  type: 'llm' | 'embedding';
  instance_id: string;
  load_time_seconds: number;
  status: 'loaded';
  load_config?: LMStudioModelLoadConfig;
}

export interface LMStudioUnloadModelRequest {
  instance_id: string;
}

export interface LMStudioUnloadModelResponse {
  instance_id: string;
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

export interface LMStudioMCPIntegration {
  type: 'ephemeral_mcp';
  server_label: string;
  server_url: string;
}

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
  integrations?: LMStudioMCPIntegration[];
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
  onToolCallStart?: (tool: string) => void;
  onToolCallArguments?: (tool: string, args: Record<string, unknown>) => void;
  onToolCallSuccess?: (tool: string, output: string) => void;
  onToolCallFailure?: (tool: string, reason: string) => void;
  onError?: (error: { type: string; message: string }) => void;
  onChatEnd?: (result: LMStudioNewChatResponse) => void;
}

// ============================================================================
// UI
// ============================================================================

// Note: Format and Structure tabs have been integrated as agent tools
// TabType kept for backward compatibility but only 'chat' is used
export type TabType = 'chat';
