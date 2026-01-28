import { LLMClient } from './LLMClient';
import { LLMMessage } from '../types';

export class OllamaClient extends LLMClient {
  constructor(baseUrl: string = 'http://localhost:11434', model: string = '') {
    super(baseUrl, model);
  }

  async listModels(): Promise<string[]> {
    try {
      const data = await this.request(`${this.baseUrl}/api/tags`, 'GET');
      return data.models.map((m: any) => m.name);
    } catch (error) {
      console.error('Failed to list Ollama models:', error);
      throw error;
    }
  }

  async chat(messages: LLMMessage[]): Promise<string> {
    if (!this.model) {
      throw new Error('No model selected');
    }

    try {
      const data = await this.request(
        `${this.baseUrl}/api/chat`,
        'POST',
        {
          model: this.model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
        }
      );

      return data.message.content;
    } catch (error) {
      console.error('Ollama chat error:', error);
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
      await this.request(`${this.baseUrl}/api/tags`, 'GET');
      return true;
    } catch {
      return false;
    }
  }
}
