import * as http from 'http';
import type VaultAIPlugin from '../main';
import { MCPToolHandler } from './MCPToolHandler';
import {
  MCPRequest,
  MCPResponse,
  MCPErrorCodes,
  MCPInitializeResult,
  MCPToolCallParams,
} from './types';

const PROTOCOL_VERSION = '2024-11-05';

export class MCPServer {
  private plugin: VaultAIPlugin;
  private server: http.Server | null = null;
  private toolHandler: MCPToolHandler;
  private port: number;

  constructor(plugin: VaultAIPlugin, port: number = 3456) {
    this.plugin = plugin;
    this.port = port;
    this.toolHandler = new MCPToolHandler(plugin);
  }

  async start(): Promise<void> {
    if (this.server) {
      console.log('[MCP Server] Server already running');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          console.error(`[MCP Server] Port ${this.port} is already in use`);
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          console.error('[MCP Server] Server error:', error);
          reject(error);
        }
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        console.log(`[MCP Server] Started on http://127.0.0.1:${this.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        console.log('[MCP Server] Stopped');
        this.server = null;
        resolve();
      });
    });
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  getUrl(): string {
    return `http://127.0.0.1:${this.port}/mcp`;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Only accept POST to /mcp
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Read body
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const request = JSON.parse(body) as MCPRequest;
        const response = await this.handleMCPRequest(request);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (error) {
        console.error('[MCP Server] Error handling request:', error);

        const errorResponse: MCPResponse = {
          jsonrpc: '2.0',
          id: 0,
          error: {
            code: MCPErrorCodes.PARSE_ERROR,
            message: 'Failed to parse request',
          },
        };

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(errorResponse));
      }
    });
  }

  private async handleMCPRequest(request: MCPRequest): Promise<MCPResponse> {
    console.log(`[MCP Server] Received: ${request.method}`, request.params);

    const baseResponse = {
      jsonrpc: '2.0' as const,
      id: request.id,
    };

    try {
      switch (request.method) {
        case 'initialize':
          return {
            ...baseResponse,
            result: this.handleInitialize(),
          };

        case 'tools/list':
          return {
            ...baseResponse,
            result: this.toolHandler.listTools(),
          };

        case 'tools/call':
          const params = request.params as MCPToolCallParams;
          if (!params?.name) {
            return {
              ...baseResponse,
              error: {
                code: MCPErrorCodes.INVALID_PARAMS,
                message: 'Tool name is required',
              },
            };
          }
          const result = await this.toolHandler.executeTool(
            params.name,
            params.arguments || {}
          );
          return {
            ...baseResponse,
            result,
          };

        case 'notifications/initialized':
          // Client acknowledgment - no response needed but return success
          return {
            ...baseResponse,
            result: {},
          };

        default:
          return {
            ...baseResponse,
            error: {
              code: MCPErrorCodes.METHOD_NOT_FOUND,
              message: `Unknown method: ${request.method}`,
            },
          };
      }
    } catch (error) {
      console.error('[MCP Server] Error processing request:', error);
      return {
        ...baseResponse,
        error: {
          code: MCPErrorCodes.INTERNAL_ERROR,
          message: `Internal error: ${error}`,
        },
      };
    }
  }

  private handleInitialize(): MCPInitializeResult {
    return {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: {
        name: 'vault-ai-mcp',
        version: '1.0.0',
        protocolVersion: PROTOCOL_VERSION,
      },
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
    };
  }
}
