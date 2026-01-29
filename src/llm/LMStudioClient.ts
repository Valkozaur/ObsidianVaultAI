import { LLMClient } from './LLMClient';
import {
  LLMMessage,
  LMStudioNewChatResponse,
  LMStudioStreamCallbacks,
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
   * New chat method using /v1/chat/completions endpoint (OpenAI-compatible)
   * Supports streaming via SSE
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
      temperature = 0.7,
      callbacks,
    } = options;

    // Build messages array in OpenAI format
    const messages: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: input });

    const requestBody = {
      model: this.model,
      messages,
      stream: !!callbacks,
      temperature,
    };

    console.log('[Vault AI] LMStudio chatV1 request:', {
      ...requestBody,
      messages: messages.map(m => ({ role: m.role, content: m.content.slice(0, 100) + '...' })),
    });

    if (callbacks) {
      return this.chatV1Streaming(requestBody, callbacks);
    } else {
      return this.chatV1NonStreaming(requestBody);
    }
  }

  /**
   * Non-streaming chat using OpenAI-compatible API
   */
  private async chatV1NonStreaming(
    requestBody: { model: string; messages: Array<{ role: string; content: string }>; stream: boolean; temperature: number }
  ): Promise<LMStudioChatResult> {
    try {
      const response = await this.request(
        `${this.baseUrl}/v1/chat/completions`,
        'POST',
        requestBody
      );

      const content = response.choices?.[0]?.message?.content || '';

      return {
        content,
        reasoning: undefined,
        responseId: response.id,
        stats: response.usage ? {
          tokens_input: response.usage.prompt_tokens,
          tokens_output: response.usage.completion_tokens,
          time_to_first_token_ms: 0,
          tokens_per_second: 0,
        } : undefined,
      };
    } catch (error) {
      console.error('LM Studio chatV1 error:', error);
      throw error;
    }
  }

  /**
   * Streaming chat using Server-Sent Events (OpenAI-compatible format)
   */
  private async chatV1Streaming(
    requestBody: { model: string; messages: Array<{ role: string; content: string }>; stream: boolean; temperature: number },
    callbacks: LMStudioStreamCallbacks
  ): Promise<LMStudioChatResult> {
    const url = `${this.baseUrl}/v1/chat/completions`;

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
      let responseId: string | undefined;
      let buffer = '';

      callbacks.onMessageStart?.();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events from buffer (OpenAI format: "data: {...}")
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();

          if (!trimmedLine || !trimmedLine.startsWith('data: ')) {
            continue;
          }

          const data = trimmedLine.slice(6); // Remove "data: " prefix

          if (data === '[DONE]') {
            // Stream complete
            callbacks.onMessageEnd?.();
            callbacks.onChatEnd?.({
              response_id: responseId || '',
              model_instance_id: '',
              output: [{ type: 'message', content }],
            });
            continue;
          }

          try {
            const chunk = JSON.parse(data);

            // Store response ID from first chunk
            if (chunk.id && !responseId) {
              responseId = chunk.id;
            }

            // Extract content delta
            const deltaContent = chunk.choices?.[0]?.delta?.content;
            if (deltaContent) {
              content += deltaContent;
              callbacks.onMessageDelta?.(deltaContent);
            }
          } catch (e) {
            console.warn('[Vault AI] Failed to parse SSE chunk:', data, e);
          }
        }
      }

      return {
        content,
        reasoning: undefined,
        responseId,
        stats: undefined,
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
