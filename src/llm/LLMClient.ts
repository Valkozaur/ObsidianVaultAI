import { requestUrl } from 'obsidian';
import { LLMMessage } from '../types';

export abstract class LLMClient {
  protected baseUrl: string;
  protected model: string;

  constructor(baseUrl: string, model: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.model = model;
  }

  setModel(model: string): void {
    this.model = model;
  }

  abstract listModels(): Promise<string[]>;
  abstract chat(messages: LLMMessage[]): Promise<string>;
  abstract chatStream(
    messages: LLMMessage[],
    onToken: (token: string) => void
  ): Promise<string>;
  abstract isConnected(): Promise<boolean>;

  protected async request(
    url: string,
    method: string,
    body?: any
  ): Promise<any> {
    console.log(`[Vault AI] Making ${method} request to: ${url}`);

    try {
      const requestOptions = {
        url,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        throw: false,
      };

      console.log('[Vault AI] Request options:', JSON.stringify(requestOptions, null, 2));

      const response = await requestUrl(requestOptions);

      console.log(`[Vault AI] Response status: ${response.status}`);
      console.log('[Vault AI] Response headers:', response.headers);

      if (response.status >= 400) {
        console.error(`[Vault AI] HTTP error: ${response.status}`, response.text);
        throw new Error(`HTTP error: ${response.status}`);
      }

      console.log('[Vault AI] Response JSON:', response.json);
      return response.json;
    } catch (error) {
      console.error('[Vault AI] Request failed:', error);
      console.error('[Vault AI] Error name:', (error as Error).name);
      console.error('[Vault AI] Error message:', (error as Error).message);
      console.error('[Vault AI] Error stack:', (error as Error).stack);
      throw error;
    }
  }
}
