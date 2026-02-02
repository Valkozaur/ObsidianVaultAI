import { LLMClient } from './LLMClient';
import {
  LLMMessage,
  LMStudioChatRequest,
  LMStudioNewChatResponse,
  LMStudioStreamEvent,
  LMStudioStreamCallbacks,
  LMStudioMCPIntegration,
} from '../types';

export interface LMStudioChatOptions {
  systemPrompt?: string;
  previousResponseId?: string;
  temperature?: number;
  store?: boolean;
  callbacks?: LMStudioStreamCallbacks;
  mcpServerUrl?: string;
  reasoning?: 'off' | 'low' | 'medium' | 'high' | 'on';
}

export interface LMStudioChatResult {
  content: string;
  reasoning?: string;
  responseId?: string;
  stats?: LMStudioNewChatResponse['stats'];
  toolCalls?: ToolCallResult[];
}

export interface ToolCallResult {
  tool: string;
  arguments: Record<string, unknown>;
  output?: string;
  success: boolean;
  error?: string;
}

export class LMStudioClient extends LLMClient {
  constructor(baseUrl: string = 'http://localhost:1234', model: string = '') {
    super(baseUrl, model);
  }

  async listModels(): Promise<string[]> {
    try {
      const data = await this.request(`${this.baseUrl}/v1/models`, 'GET');
      return data.data.map((m: any) => m.id);
    } catch (error) {
      console.error('Failed to list LM Studio models:', error);
      throw error;
    }
  }

  /**
   * Legacy chat method for backwards compatibility
   * Uses the old /v1/chat/completions endpoint
   */
  async chat(messages: LLMMessage[]): Promise<string> {
    if (!this.model) {
      throw new Error('No model selected');
    }

    try {
      const data = await this.request(
        `${this.baseUrl}/v1/chat/completions`,
        'POST',
        {
          model: this.model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
          temperature: 0.7,
        }
      );

      return data.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('LM Studio chat error:', error);
      throw error;
    }
  }

  /**
   * New chat method using /api/v1/chat endpoint
   * Supports streaming, reasoning, and response_id for conversation continuity
   */
  async chatV1(
    input: string,
    options: LMStudioChatOptions = {}
  ): Promise<LMStudioChatResult> {
    if (!this.model) {
      throw new Error('No model selected');
    }

    const {
      systemPrompt,
      previousResponseId,
      temperature = 0.7,
      store = true,
      callbacks,
      mcpServerUrl,
      reasoning,
    } = options;

    const requestBody: LMStudioChatRequest = {
      model: this.model,
      input,
      stream: !!callbacks,
      temperature,
      store,
    };

    if (systemPrompt) {
      requestBody.system_prompt = systemPrompt;
    }

    if (previousResponseId) {
      requestBody.previous_response_id = previousResponseId;
    }

    // Add reasoning setting if provided
    if (reasoning) {
      requestBody.reasoning = reasoning;
    }

    // Add MCP integration if provided
    if (mcpServerUrl) {
      requestBody.integrations = [
        {
          type: 'ephemeral_mcp',
          server_label: 'vault-ai-mcp',
          server_url: mcpServerUrl,
        },
      ];
    }

    console.log('[Vault AI] LMStudio chatV1 request:', {
      ...requestBody,
      input: input.slice(0, 100) + '...',
    });

    if (callbacks) {
      return this.chatV1Streaming(requestBody, callbacks);
    } else {
      return this.chatV1NonStreaming(requestBody);
    }
  }

  /**
   * Chat with MCP integration enabled
   * This method automatically includes the MCP server URL for tool execution
   */
  async chatWithMCP(
    input: string,
    mcpServerUrl: string,
    options: Omit<LMStudioChatOptions, 'mcpServerUrl'> = {}
  ): Promise<LMStudioChatResult> {
    return this.chatV1(input, {
      ...options,
      mcpServerUrl,
    });
  }

  /**
   * Non-streaming chat using the new API
   */
  private async chatV1NonStreaming(
    requestBody: LMStudioChatRequest
  ): Promise<LMStudioChatResult> {
    try {
      const response: LMStudioNewChatResponse = await this.request(
        `${this.baseUrl}/api/v1/chat`,
        'POST',
        requestBody
      );

      let content = '';
      let reasoning = '';
      const toolCalls: ToolCallResult[] = [];

      for (const item of response.output) {
        if (item.type === 'message' && item.content) {
          content += item.content;
        } else if (item.type === 'reasoning' && item.content) {
          reasoning += item.content;
        } else if (item.type === 'tool_call') {
          toolCalls.push({
            tool: item.tool || 'unknown',
            arguments: item.arguments || {},
            output: item.output,
            success: true,
          });
        } else if (item.type === 'invalid_tool_call') {
          toolCalls.push({
            tool: item.tool || 'unknown',
            arguments: item.arguments || {},
            success: false,
            error: item.reason,
          });
        }
      }

      return {
        content,
        reasoning: reasoning || undefined,
        responseId: response.response_id,
        stats: response.stats,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      console.error('LM Studio chatV1 error:', error);
      throw error;
    }
  }

  /**
   * Streaming chat using Server-Sent Events
   */
  private async chatV1Streaming(
    requestBody: LMStudioChatRequest,
    callbacks: LMStudioStreamCallbacks
  ): Promise<LMStudioChatResult> {
    const url = `${this.baseUrl}/api/v1/chat`;

    console.log('[Vault AI] Starting streaming request to:', url);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        // Try to extract the actual error message from the response body
        let errorMessage = `HTTP error: ${response.status}`;
        try {
          const errorBody = await response.json();
          console.error('[Vault AI] Streaming error response:', errorBody);
          if (errorBody?.error?.message) {
            errorMessage = errorBody.error.message;
          }
        } catch {
          // If JSON parsing fails, try to get text
          try {
            const errorText = await response.text();
            console.error('[Vault AI] Streaming error response text:', errorText);
            if (errorText.length > 0) {
              errorMessage = errorText;
            }
          } catch {
            // Ignore text parsing errors
          }
        }
        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let content = '';
      let reasoning = '';
      let responseId: string | undefined;
      let stats: LMStudioNewChatResponse['stats'] | undefined;
      let buffer = '';
      const toolCalls: ToolCallResult[] = [];
      let currentToolCall: Partial<ToolCallResult> | null = null;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        let eventType: string | null = null;
        let eventData: string | null = null;

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            eventData = line.slice(6);

            if (eventType && eventData) {
              try {
                const event: LMStudioStreamEvent = JSON.parse(eventData);
                this.handleStreamEvent(event, callbacks, {
                  addContent: (c) => (content += c),
                  addReasoning: (r) => (reasoning += r),
                  setResponseId: (id) => (responseId = id),
                  setStats: (s) => (stats = s),
                  getCurrentToolCall: () => currentToolCall,
                  setCurrentToolCall: (tc) => (currentToolCall = tc),
                  addToolCall: (tc) => toolCalls.push(tc as ToolCallResult),
                });
              } catch (e) {
                console.warn('[Vault AI] Failed to parse SSE event:', eventData, e);
              }
            }

            eventType = null;
            eventData = null;
          } else if (line === '') {
            // Empty line marks end of an event
            eventType = null;
            eventData = null;
          }
        }
      }

      return {
        content,
        reasoning: reasoning || undefined,
        responseId,
        stats,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };
    } catch (error) {
      console.error('LM Studio streaming error:', error);
      callbacks.onError?.({
        type: 'unknown',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Handle individual stream events
   */
  private handleStreamEvent(
    event: LMStudioStreamEvent,
    callbacks: LMStudioStreamCallbacks,
    state: {
      addContent: (c: string) => void;
      addReasoning: (r: string) => void;
      setResponseId: (id: string) => void;
      setStats: (s: LMStudioNewChatResponse['stats']) => void;
      getCurrentToolCall: () => Partial<ToolCallResult> | null;
      setCurrentToolCall: (tc: Partial<ToolCallResult> | null) => void;
      addToolCall: (tc: ToolCallResult) => void;
    }
  ): void {
    switch (event.type) {
      case 'message.start':
        callbacks.onMessageStart?.();
        break;

      case 'message.delta':
        if (event.content) {
          state.addContent(event.content);
          callbacks.onMessageDelta?.(event.content);
        }
        break;

      case 'message.end':
        callbacks.onMessageEnd?.();
        break;

      case 'reasoning.start':
        callbacks.onReasoningStart?.();
        break;

      case 'reasoning.delta':
        if (event.content) {
          state.addReasoning(event.content);
          callbacks.onReasoningDelta?.(event.content);
        }
        break;

      case 'reasoning.end':
        callbacks.onReasoningEnd?.();
        break;

      case 'tool_call.start':
        if (event.tool) {
          state.setCurrentToolCall({
            tool: event.tool,
            arguments: {},
            success: false,
          });
          callbacks.onToolCallStart?.(event.tool);
        }
        break;

      case 'tool_call.arguments':
        const currentTc = state.getCurrentToolCall();
        if (currentTc && event.arguments) {
          currentTc.arguments = event.arguments;
          callbacks.onToolCallArguments?.(currentTc.tool || '', event.arguments);
        }
        break;

      case 'tool_call.success':
        const successTc = state.getCurrentToolCall();
        if (successTc) {
          successTc.success = true;
          successTc.output = event.output;
          state.addToolCall(successTc as ToolCallResult);
          callbacks.onToolCallSuccess?.(successTc.tool || '', event.output || '');
          state.setCurrentToolCall(null);
        }
        break;

      case 'tool_call.failure':
        const failTc = state.getCurrentToolCall();
        if (failTc) {
          failTc.success = false;
          failTc.error = event.reason;
          state.addToolCall(failTc as ToolCallResult);
          callbacks.onToolCallFailure?.(failTc.tool || '', event.reason || '');
          state.setCurrentToolCall(null);
        }
        break;

      case 'model_load.progress':
        if (event.progress !== undefined) {
          callbacks.onModelLoadProgress?.(event.progress);
        }
        break;

      case 'prompt_processing.progress':
        if (event.progress !== undefined) {
          callbacks.onPromptProcessingProgress?.(event.progress);
        }
        break;

      case 'error':
        if (event.error) {
          callbacks.onError?.(event.error);
        }
        break;

      case 'chat.end':
        if (event.result) {
          if (event.result.response_id) {
            state.setResponseId(event.result.response_id);
          }
          if (event.result.stats) {
            state.setStats(event.result.stats);
          }
          callbacks.onChatEnd?.(event.result);
        }
        break;
    }
  }

  async chatStream(
    messages: LLMMessage[],
    onToken: (token: string) => void
  ): Promise<string> {
    // Convert LLMMessage array to single input for the new API
    const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
    const systemMessage = messages.find((m) => m.role === 'system');

    if (!lastUserMessage) {
      throw new Error('No user message found');
    }

    const result = await this.chatV1(lastUserMessage.content, {
      systemPrompt: systemMessage?.content,
      callbacks: {
        onMessageDelta: onToken,
      },
    });

    return result.content;
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.request(`${this.baseUrl}/v1/models`, 'GET');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a concise title for a chat session based on the first user message.
   * This is designed to be called asynchronously without blocking the main chat response.
   */
  async generateSessionTitle(userMessage: string): Promise<string> {
    if (!this.model) {
      throw new Error('No model selected');
    }

    // Small delay to avoid race condition with the main chat request
    // This ensures LM Studio's internal state is stable before making a second request
    await new Promise(resolve => setTimeout(resolve, 500));

    const systemPrompt = `You are a helpful assistant that generates concise, descriptive titles for chat conversations.
Based on the user's first message, create a short title (3-6 words) that captures the main topic or intent.
Rules:
- Output ONLY the title, nothing else
- No quotes, punctuation at the end, or explanations
- Be specific but concise
- Use title case`;

    const input = `Generate a title for a conversation that starts with this message: "${userMessage}"`;

    try {
      const requestBody: LMStudioChatRequest = {
        model: this.model,
        input,
        system_prompt: systemPrompt,
        stream: false,
        temperature: 0.7,
        store: false, // Don't store title generation requests
        previous_response_id: undefined, // Explicitly ensure no conversation continuity
      };

      const response: LMStudioNewChatResponse = await this.request(
        `${this.baseUrl}/api/v1/chat`,
        'POST',
        requestBody
      );

      let title = '';
      for (const item of response.output) {
        if (item.type === 'message' && item.content) {
          title += item.content;
        }
      }

      // Clean up the title - remove quotes, trim, and limit length
      title = title.trim().replace(/^["']|["']$/g, '').trim();

      // Ensure title isn't too long (max 60 chars)
      if (title.length > 60) {
        title = title.substring(0, 57) + '...';
      }

      return title || 'New Chat';
    } catch (error) {
      console.error('[Vault AI] Error generating session title:', error);
      // Return a fallback title based on the message content
      const maxLength = 50;
      const cleaned = userMessage.replace(/\s+/g, ' ').trim();
      if (cleaned.length <= maxLength) {
        return cleaned;
      }
      return cleaned.substring(0, maxLength).trim() + '...';
    }
  }
}
