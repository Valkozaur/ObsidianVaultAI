import type VaultAIPlugin from '../main';
import { Conversation, ChatHistory, ChatMessage, ContextScope } from '../types';
import { LMStudioClient } from '../llm/LMStudioClient';

const CHAT_HISTORY_KEY = 'chat-history';

export class ChatHistoryManager {
  private plugin: VaultAIPlugin;
  private history: ChatHistory;

  constructor(plugin: VaultAIPlugin) {
    this.plugin = plugin;
    this.history = {
      conversations: [],
      activeConversationId: null,
    };
  }

  async load(): Promise<void> {
    const data = await this.plugin.loadData();
    if (data && data[CHAT_HISTORY_KEY]) {
      this.history = data[CHAT_HISTORY_KEY];
    }
  }

  async save(): Promise<void> {
    const data = (await this.plugin.loadData()) || {};
    data[CHAT_HISTORY_KEY] = this.history;
    await this.plugin.saveData(data);
  }

  getHistory(): ChatHistory {
    return this.history;
  }

  getConversations(): Conversation[] {
    return [...this.history.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getConversation(id: string): Conversation | undefined {
    return this.history.conversations.find((c) => c.id === id);
  }

  getActiveConversation(): Conversation | undefined {
    if (!this.history.activeConversationId) return undefined;
    return this.getConversation(this.history.activeConversationId);
  }

  async createConversation(scope: ContextScope): Promise<Conversation> {
    const conversation: Conversation = {
      id: this.generateId(),
      title: 'New Chat',
      messages: [],
      contextScope: scope,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.history.conversations.push(conversation);
    this.history.activeConversationId = conversation.id;
    await this.save();

    return conversation;
  }

  async setActiveConversation(id: string | null): Promise<void> {
    this.history.activeConversationId = id;
    await this.save();
  }

  async addMessage(conversationId: string, message: ChatMessage): Promise<void> {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;

    conversation.messages.push(message);
    conversation.updatedAt = Date.now();

    // Auto-generate title from first user message if still "New Chat"
    if (conversation.title === 'New Chat' && message.role === 'user') {
      conversation.title = this.generateTitle(message.content);
    }

    await this.save();
  }

  async updateConversationScope(conversationId: string, scope: ContextScope): Promise<void> {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;

    conversation.contextScope = scope;
    conversation.updatedAt = Date.now();
    await this.save();
  }

  async renameConversation(id: string, newTitle: string): Promise<void> {
    const conversation = this.getConversation(id);
    if (!conversation) return;

    conversation.title = newTitle.trim() || 'Untitled';
    conversation.updatedAt = Date.now();
    await this.save();
  }

  /**
   * Asynchronously generate an AI-powered title for a conversation based on the first message.
   * This runs in the background and updates the conversation title when complete.
   * Returns a callback function that can be used to refresh the UI after the title is updated.
   */
  async generateAITitle(
    conversationId: string,
    userMessage: string,
    onTitleGenerated?: () => void
  ): Promise<void> {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;

    // Only generate AI title if the conversation still has the default title
    if (conversation.title !== 'New Chat') return;

    const llmClient = this.plugin.llmClient;
    if (!(llmClient instanceof LMStudioClient)) {
      console.warn('[Vault AI] LLM client does not support title generation');
      return;
    }

    try {
      console.log('[Vault AI] Generating AI title for conversation:', conversationId);
      const aiTitle = await llmClient.generateSessionTitle(userMessage);

      // Verify the conversation still exists and hasn't been renamed manually
      const currentConversation = this.getConversation(conversationId);
      if (currentConversation && currentConversation.title === 'New Chat') {
        currentConversation.title = aiTitle;
        currentConversation.updatedAt = Date.now();
        await this.save();
        console.log('[Vault AI] AI title generated:', aiTitle);

        // Notify the UI to refresh
        if (onTitleGenerated) {
          onTitleGenerated();
        }
      }
    } catch (error) {
      console.error('[Vault AI] Failed to generate AI title:', error);
      // Fallback: keep the simple truncated title that was already set
    }
  }

  async updateLMStudioResponseId(conversationId: string, responseId: string): Promise<void> {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;

    conversation.lmStudioResponseId = responseId;
    conversation.updatedAt = Date.now();
    await this.save();
  }

  getLMStudioResponseId(conversationId: string): string | undefined {
    const conversation = this.getConversation(conversationId);
    return conversation?.lmStudioResponseId;
  }

  async deleteConversation(id: string): Promise<void> {
    const index = this.history.conversations.findIndex((c) => c.id === id);
    if (index === -1) return;

    this.history.conversations.splice(index, 1);

    // If we deleted the active conversation, clear the active ID
    if (this.history.activeConversationId === id) {
      // Set to the most recent conversation, or null if none left
      const remaining = this.getConversations();
      this.history.activeConversationId = remaining.length > 0 ? remaining[0].id : null;
    }

    await this.save();
  }

  async clearAllHistory(): Promise<void> {
    this.history = {
      conversations: [],
      activeConversationId: null,
    };
    await this.save();
  }

  private generateId(): string {
    return `conv-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private generateTitle(content: string): string {
    // Take first 50 characters, trim, and add ellipsis if needed
    const maxLength = 50;
    const cleaned = content.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) {
      return cleaned;
    }
    return cleaned.substring(0, maxLength).trim() + '...';
  }
}
