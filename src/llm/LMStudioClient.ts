import { LLMClient } from './LLMClient';
import {
  LLMMessage,
  LMStudioChatRequest,
  LMStudioNewChatResponse,
  LMStudioStreamEvent,
  LMStudioStreamCallbacks,
  LMStudioIntegration,
  LMStudioToolCallOutput,
  LMStudioToolCallInfo,
} from '../types';

export interface LMStudioChatOptions {
  systemPrompt?: string;
  previousResponseId?: string;
  temperature?: number;
  store?: boolean;
  callbacks?: LMStudioStreamCallbacks;
  // New options for MCP and tools
  integrations?: LMStudioIntegration[];
  contextLength?: number;
  reasoning?: 'off' | 'low' | 'medium' | 'high' | 'on';
}

export interface LMStudioChatResult {
  content: string;
  reasoning?: string;
  responseId?: string;
  stats?: LMStudioNewChatResponse['stats'];
  toolCalls?: LMStudioToolCallOutput[];
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
      integrations,
      contextLength,
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

    // Add MCP integrations if provided
    if (integrations && integrations.length > 0) {
      requestBody.integrations = integrations;
    }

    // Add context length for MCP usage
    if (contextLength) {
      requestBody.context_length = contextLength;
    }

    // Add reasoning setting
    if (reasoning) {
      requestBody.reasoning = reasoning;
    }

    console.log('[Vault AI] LMStudio chatV1 request:', {
      ...requestBody,
      input: typeof input === 'string' ? input.slice(0, 100) + '...' : input,
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
      const toolCalls: LMStudioToolCallOutput[] = [];

      for (const item of response.output) {
        if (item.type === 'message') {
          content += item.content;
        } else if (item.type === 'reasoning') {
          reasoning += item.content;
        } else if (item.type === 'tool_call') {
          toolCalls.push(item);
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
      const toolCalls: LMStudioToolCallOutput[] = [];
      let currentToolCall: Partial<LMStudioToolCallInfo> | null = null;
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
                  addToolCall: (tc) => toolCalls.push(tc),
                  setCurrentToolCall: (tc) => (currentToolCall = tc),
                  getCurrentToolCall: () => currentToolCall,
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
      addToolCall: (tc: LMStudioToolCallOutput) => void;
      setCurrentToolCall: (tc: Partial<LMStudioToolCallInfo> | null) => void;
      getCurrentToolCall: () => Partial<LMStudioToolCallInfo> | null;
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

      // Tool call events
      case 'tool_call.start':
        if (event.tool) {
          const toolInfo: LMStudioToolCallInfo = {
            tool: event.tool,
            arguments: event.arguments || {},
            provider_info: event.provider_info,
          };
          state.setCurrentToolCall(toolInfo);
          callbacks.onToolCallStart?.(toolInfo);
        }
        break;

      case 'tool_call.arguments':
        if (event.arguments) {
          const current = state.getCurrentToolCall();
          if (current) {
            current.arguments = { ...current.arguments, ...event.arguments };
          }
          callbacks.onToolCallArguments?.(event.arguments);
        }
        break;

      case 'tool_call.output':
        if (event.output) {
          callbacks.onToolCallOutput?.(event.output);
        }
        break;

      case 'tool_call.success':
        {
          const current = state.getCurrentToolCall();
          if (current && current.tool && event.output !== undefined) {
            const toolCallOutput: LMStudioToolCallOutput = {
              type: 'tool_call',
              tool: current.tool,
              arguments: current.arguments || {},
              output: event.output,
              provider_info: current.provider_info || { type: 'plugin' },
            };
            state.addToolCall(toolCallOutput);
            callbacks.onToolCallSuccess?.(toolCallOutput);
          }
          state.setCurrentToolCall(null);
        }
        break;

      case 'tool_call.failure':
        {
          const current = state.getCurrentToolCall();
          callbacks.onToolCallFailure?.(
            event.reason || 'Unknown error',
            current as LMStudioToolCallInfo | undefined
          );
          state.setCurrentToolCall(null);
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
