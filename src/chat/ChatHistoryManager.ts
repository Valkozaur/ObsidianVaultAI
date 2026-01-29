import type VaultAIPlugin from '../main';
import { Conversation, ChatHistory, ChatMessage, ContextScope, LMStudioToolCallOutput } from '../types';

const CHAT_HISTORY_KEY = 'chat-history';

/**
 * ChatHistoryManager handles local conversation storage and syncs with LMStudio's stateful sessions.
 * When using LMStudio, the conversation state is primarily maintained by LMStudio via response_id,
 * while this manager keeps a local cache for display and offline access.
 */
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

  /**
   * Start a new LMStudio session for a conversation.
   * This clears the existing response_id so a fresh session is started.
   */
  async startNewLMStudioSession(conversationId: string): Promise<void> {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;

    conversation.lmStudioResponseId = undefined;
    conversation.updatedAt = Date.now();
    await this.save();
  }

  /**
   * Check if a conversation has an active LMStudio session.
   */
  hasLMStudioSession(conversationId: string): boolean {
    const conversation = this.getConversation(conversationId);
    return !!conversation?.lmStudioResponseId;
  }

  /**
   * Add a message with tool calls from LMStudio.
   * This tracks MCP tool calls that were executed by LMStudio.
   */
  async addMessageWithToolCalls(
    conversationId: string,
    message: ChatMessage,
    toolCalls?: LMStudioToolCallOutput[]
  ): Promise<void> {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;

    // If there are tool calls, add them to the message's agentSteps
    if (toolCalls && toolCalls.length > 0) {
      message.agentSteps = toolCalls.map(tc => ({
        type: 'tool_call' as const,
        toolCall: {
          tool: tc.tool,
          params: tc.arguments as Record<string, any>,
        },
        toolResult: {
          success: true,
          result: tc.output,
        },
      }));

      // Track actions performed by tool calls
      message.actionsPerformed = toolCalls.map(tc =>
        `[${tc.provider_info?.server_label || tc.provider_info?.plugin_id || 'MCP'}] ${tc.tool}(${JSON.stringify(tc.arguments).slice(0, 50)}...)`
      );
    }

    conversation.messages.push(message);
    conversation.updatedAt = Date.now();

    // Auto-generate title from first user message if still "New Chat"
    if (conversation.title === 'New Chat' && message.role === 'user') {
      conversation.title = this.generateTitle(message.content);
    }

    await this.save();
  }

  /**
   * Get the last message in a conversation.
   */
  getLastMessage(conversationId: string): ChatMessage | undefined {
    const conversation = this.getConversation(conversationId);
    if (!conversation || conversation.messages.length === 0) return undefined;
    return conversation.messages[conversation.messages.length - 1];
  }

  /**
   * Update the last assistant message in a conversation.
   * Used when LMStudio streaming completes to update the message.
   */
  async updateLastAssistantMessage(
    conversationId: string,
    updates: Partial<ChatMessage>
  ): Promise<void> {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;

    // Find the last assistant message
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      if (conversation.messages[i].role === 'assistant') {
        conversation.messages[i] = { ...conversation.messages[i], ...updates };
        break;
      }
    }

    conversation.updatedAt = Date.now();
    await this.save();
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
