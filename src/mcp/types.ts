// MCP Protocol Types for JSON-RPC 2.0 communication

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC 2.0 error codes
export const MCPErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ============================================================================
// MCP Tool Schema Types
// ============================================================================

export interface MCPToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, MCPPropertySchema>;
    required: string[];
  };
}

export interface MCPPropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  default?: unknown;
  enum?: string[];
  items?: MCPPropertySchema;
}

// ============================================================================
// MCP Server Info Types
// ============================================================================

export interface MCPServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
}

export interface MCPCapabilities {
  tools?: {
    listChanged?: boolean;
  };
}

export interface MCPInitializeResult {
  protocolVersion: string;
  serverInfo: MCPServerInfo;
  capabilities: MCPCapabilities;
}

// ============================================================================
// MCP Tool Execution Types
// ============================================================================

export interface MCPToolCallParams {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolResult {
  content: MCPToolContent[];
  isError?: boolean;
}

export interface MCPToolContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

// ============================================================================
// MCP Tools List Response
// ============================================================================

export interface MCPToolsListResult {
  tools: MCPToolSchema[];
}

// ============================================================================
// LMStudio Integration Types
// ============================================================================

export interface LMStudioMCPIntegration {
  type: 'ephemeral_mcp';
  server_label: string;
  server_url: string;
}

// ============================================================================
// Tool Call Streaming Event Types
// ============================================================================

export interface MCPToolCallEvent {
  type: 'tool_call.start' | 'tool_call.arguments' | 'tool_call.success' | 'tool_call.failure';
  tool?: string;
  arguments?: Record<string, unknown>;
  output?: string;
  reason?: string;
}
