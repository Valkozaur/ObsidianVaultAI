// MCP Protocol Types - JSON-RPC 2.0 based
// Based on Model Context Protocol specification

// ============================================================================
// JSON-RPC 2.0 Base Types
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// Standard JSON-RPC error codes
export const JSON_RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ============================================================================
// MCP Initialization Types
// ============================================================================

export interface MCPClientInfo {
  name: string;
  version: string;
  title?: string;
}

export interface MCPServerInfo {
  name: string;
  version: string;
  title?: string;
}

export interface MCPCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: Record<string, never>;
}

export interface InitializeParams {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  clientInfo: MCPClientInfo;
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: MCPCapabilities;
  serverInfo: MCPServerInfo;
  instructions?: string;
}

// ============================================================================
// MCP Tool Types
// ============================================================================

export interface MCPToolDefinition {
  name: string;
  description: string;
  title?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
    additionalProperties?: boolean;
  };
  outputSchema?: object;
}

export interface ToolsListResult {
  tools: MCPToolDefinition[];
  nextCursor?: string;
}

export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface MCPTextContent {
  type: 'text';
  text: string;
}

export interface MCPImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export type MCPContent = MCPTextContent | MCPImageContent;

export interface ToolCallResult {
  content: MCPContent[];
  isError?: boolean;
  structuredContent?: unknown;
}

// ============================================================================
// Protocol Constants
// ============================================================================

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const MCP_METHODS = {
  INITIALIZE: 'initialize',
  INITIALIZED: 'notifications/initialized',
  TOOLS_LIST: 'tools/list',
  TOOLS_CALL: 'tools/call',
  PING: 'ping',
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

export function createJsonRpcResponse(
  id: string | number,
  result: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

export function createJsonRpcError(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

export function isJsonRpcRequest(obj: unknown): obj is JsonRpcRequest {
  if (typeof obj !== 'object' || obj === null) return false;
  const req = obj as Record<string, unknown>;
  return (
    req.jsonrpc === '2.0' &&
    typeof req.method === 'string' &&
    (typeof req.id === 'string' || typeof req.id === 'number')
  );
}

export function isJsonRpcNotification(obj: unknown): obj is JsonRpcNotification {
  if (typeof obj !== 'object' || obj === null) return false;
  const notif = obj as Record<string, unknown>;
  return (
    notif.jsonrpc === '2.0' &&
    typeof notif.method === 'string' &&
    !('id' in notif)
  );
}
