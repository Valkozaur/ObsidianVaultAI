import { LLMClient } from './LLMClient';
import {
  LLMMessage,
  LMStudioChatRequest,
  LMStudioNewChatResponse,
  LMStudioStreamEvent,
  LMStudioStreamCallbacks,
  OpenAITool,
  OpenAIChatMessage,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIChatCompletionChunk,
  OpenAIToolCall,
  ToolExecutor,
  ToolExecutionResult,
} from '../types';

export interface LMStudioChatOptions {
  systemPrompt?: string;
  previousResponseId?: string;
  temperature?: number;
  store?: boolean;
  callbacks?: LMStudioStreamCallbacks;
}

export interface LMStudioChatResult {
  content: string;
  reasoning?: string;
  responseId?: string;
  stats?: LMStudioNewChatResponse['stats'];
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: ToolExecutionResult;
  }>;
}

export interface LMStudioToolChatOptions {
  systemPrompt?: string;
  tools?: OpenAITool[];
  toolExecutor?: ToolExecutor;
  maxToolIterations?: number;
  temperature?: number;
  callbacks?: LMStudioStreamCallbacks;
}

export interface LMStudioToolChatResult {
  content: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    result: ToolExecutionResult;
  }>;
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
   * Chat with tool calling support using /v1/chat/completions endpoint
   * This allows the model to call tools and receive results
   */
  async chatWithTools(
    userMessage: string,
    options: LMStudioToolChatOptions = {}
  ): Promise<LMStudioToolChatResult> {
    if (!this.model) {
      throw new Error('No model selected');
    }

    const {
      systemPrompt,
      tools = [],
      toolExecutor,
      maxToolIterations = 10,
      temperature = 0.7,
      callbacks,
    } = options;

    const messages: OpenAIChatMessage[] = [];

    // Add system prompt if provided
    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    // Add user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    const allToolCalls: Array<{
      name: string;
      args: Record<string, unknown>;
      result: ToolExecutionResult;
    }> = [];

    let iteration = 0;
    let finalContent = '';

    while (iteration < maxToolIterations) {
      iteration++;
      console.log(`[Vault AI] Tool chat iteration ${iteration}`);

      // Build request
      const request: OpenAIChatCompletionRequest = {
        model: this.model,
        messages,
        temperature,
        stream: !!callbacks,
      };

      if (tools.length > 0) {
        request.tools = tools;
        request.tool_choice = 'auto';
      }

      let response: OpenAIChatCompletionResponse;

      if (callbacks) {
        response = await this.chatCompletionStreaming(request, callbacks);
      } else {
        response = await this.chatCompletionNonStreaming(request);
      }

      const choice = response.choices[0];
      const assistantMessage = choice.message;

      // Add assistant message to conversation
      messages.push({
        role: 'assistant',
        content: assistantMessage.content,
        tool_calls: assistantMessage.tool_calls,
      });

      // Check if the model wants to call tools
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        // Process each tool call
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          let args: Record<string, unknown>;

          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            console.error('[Vault AI] Failed to parse tool arguments:', e);
            args = {};
          }

          console.log(`[Vault AI] Tool call: ${toolName}`, args);
          callbacks?.onToolCallStart?.(toolName, args);

          let result: ToolExecutionResult;

          if (toolExecutor) {
            result = await toolExecutor(toolName, args);
          } else {
            result = {
              success: false,
              result: `Tool executor not provided for tool: ${toolName}`,
            };
          }

          console.log(`[Vault AI] Tool result:`, result);
          callbacks?.onToolCallEnd?.(toolName, result.result, result.success);

          allToolCalls.push({ name: toolName, args, result });

          // Add tool result to messages
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result.result,
          });
        }

        // Continue the loop to let the model process tool results
        continue;
      }

      // No tool calls, we have a final response
      finalContent = assistantMessage.content || '';
      break;
    }

    if (iteration >= maxToolIterations && !finalContent) {
      finalContent = 'Maximum tool iterations reached without a final response.';
    }

    return {
      content: finalContent,
      toolCalls: allToolCalls,
    };
  }

  /**
   * Non-streaming chat completion
   */
  private async chatCompletionNonStreaming(
    request: OpenAIChatCompletionRequest
  ): Promise<OpenAIChatCompletionResponse> {
    request.stream = false;

    try {
      const response: OpenAIChatCompletionResponse = await this.request(
        `${this.baseUrl}/v1/chat/completions`,
        'POST',
        request
      );
      return response;
    } catch (error) {
      console.error('LM Studio chat completion error:', error);
      throw error;
    }
  }

  /**
   * Streaming chat completion with tool calling support
   */
  private async chatCompletionStreaming(
    request: OpenAIChatCompletionRequest,
    callbacks: LMStudioStreamCallbacks
  ): Promise<OpenAIChatCompletionResponse> {
    const url = `${this.baseUrl}/v1/chat/completions`;
    request.stream = true;

    console.log('[Vault AI] Starting streaming chat completion');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let content = '';
      let toolCalls: OpenAIToolCall[] = [];
      let currentToolCallIndex: number | null = null;
      const toolCallBuilders: Map<number, { id: string; name: string; arguments: string }> = new Map();

      callbacks.onMessageStart?.();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();

            if (data === '[DONE]') {
              continue;
            }

            try {
              const chunk: OpenAIChatCompletionChunk = JSON.parse(data);
              const delta = chunk.choices[0]?.delta;

              if (delta) {
                // Handle content delta
                if (delta.content) {
                  content += delta.content;
                  callbacks.onMessageDelta?.(delta.content);
                }

                // Handle tool calls
                if (delta.tool_calls) {
                  for (const toolCallDelta of delta.tool_calls) {
                    const index = toolCallDelta.index;

                    if (!toolCallBuilders.has(index)) {
                      toolCallBuilders.set(index, {
                        id: toolCallDelta.id || '',
                        name: toolCallDelta.function?.name || '',
                        arguments: '',
                      });
                    }

                    const builder = toolCallBuilders.get(index)!;

                    if (toolCallDelta.id) {
                      builder.id = toolCallDelta.id;
                    }

                    if (toolCallDelta.function?.name) {
                      builder.name = toolCallDelta.function.name;
                    }

                    if (toolCallDelta.function?.arguments) {
                      builder.arguments += toolCallDelta.function.arguments;
                    }
                  }
                }
              }

              // Check finish reason
              const finishReason = chunk.choices[0]?.finish_reason;
              if (finishReason === 'tool_calls') {
                // Convert builders to tool calls
                toolCalls = Array.from(toolCallBuilders.values()).map((b) => ({
                  id: b.id,
                  type: 'function' as const,
                  function: {
                    name: b.name,
                    arguments: b.arguments,
                  },
                }));
              }
            } catch (e) {
              console.warn('[Vault AI] Failed to parse SSE chunk:', data, e);
            }
          }
        }
      }

      callbacks.onMessageEnd?.();

      // Construct the response
      const result: OpenAIChatCompletionResponse = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: request.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: content || null,
              tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            },
            finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
          },
        ],
      };

      return result;
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
   * New chat method using /api/v1/chat endpoint
   * Supports streaming, reasoning, and response_id for conversation continuity
   * Note: This endpoint does NOT support custom tools, only MCP integrations
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

      for (const item of response.output) {
        if (item.type === 'message' && item.content) {
          content += item.content;
        } else if (item.type === 'reasoning' && item.content) {
          reasoning += item.content;
        }
      }

      return {
        content,
        reasoning: reasoning || undefined,
        responseId: response.response_id,
        stats: response.stats,
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
        throw new Error(`HTTP error: ${response.status}`);
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
}
