import { LLMClient } from './LLMClient';
import { LLMMessage } from '../types';

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

  async chatStream(
    messages: LLMMessage[],
    onToken: (token: string) => void
  ): Promise<string> {
    // requestUrl doesn't support streaming, so we use non-streaming mode
    // and return the full response at once
    const response = await this.chat(messages);
    onToken(response);
    return response;
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
