import type VaultAIPlugin from '../main';
import { VaultSearch } from './VaultSearch';
import {
  ContextScope,
  AgenticSearchResult,
  SearchStep,
  LLMMessage,
} from '../types';

export class AgenticSearch {
  private plugin: VaultAIPlugin;
  private vaultSearch: VaultSearch;

  constructor(plugin: VaultAIPlugin) {
    this.plugin = plugin;
    this.vaultSearch = new VaultSearch(plugin.app);
  }

  async search(
    userQuery: string,
    scope: ContextScope
  ): Promise<AgenticSearchResult> {
    const steps: SearchStep[] = [];
    const collectedSources = new Set<string>();
    const collectedContext: string[] = [];

    // Get current file path for scoped searches
    const currentFile = this.plugin.app.workspace.getActiveFile();
    const currentFilePath = currentFile?.path;

    console.log('[Vault AI] Starting search for:', userQuery);
    console.log('[Vault AI] Scope:', scope);
    console.log('[Vault AI] Current file:', currentFilePath);

    // Step 1: Extract search terms from the query
    const searchTerms = this.extractSearchTerms(userQuery);
    console.log('[Vault AI] Extracted search terms:', searchTerms);

    steps.push({
      iteration: 1,
      action: 'Extract search terms',
      query: searchTerms.join(', '),
      reasoning: `Extracted keywords from query: ${searchTerms.join(', ')}`,
      results: [],
    });

    // Step 2: Search the vault
    const searchResults = await this.vaultSearch.searchFiles(
      searchTerms.join(' '),
      scope,
      currentFilePath
    );

    console.log('[Vault AI] Search results:', searchResults.length, 'files found');

    steps.push({
      iteration: 2,
      action: 'Search vault',
      query: searchTerms.join(' '),
      reasoning: `Found ${searchResults.length} file(s) with matches`,
      results: searchResults,
    });

    // Collect context from search results
    // Limit total context to avoid exceeding model's context window
    const MAX_FILES = 3;
    const MAX_CHARS_PER_FILE = 1500;
    const MAX_TOTAL_CHARS = 4000;
    let totalChars = 0;

    for (const result of searchResults.slice(0, MAX_FILES)) {
      if (totalChars >= MAX_TOTAL_CHARS) {
        console.log('[Vault AI] Reached max total context, stopping file collection');
        break;
      }

      collectedSources.add(result.filePath);

      // Get context by reading the file
      const fileContent = await this.vaultSearch.getFileContent(result.filePath);
      if (fileContent) {
        // Calculate how much we can take from this file
        const remainingBudget = MAX_TOTAL_CHARS - totalChars;
        const charsToTake = Math.min(fileContent.length, MAX_CHARS_PER_FILE, remainingBudget);
        const truncatedContent = fileContent.slice(0, charsToTake);

        collectedContext.push(
          `## From: ${result.fileName}\n\n${truncatedContent}${fileContent.length > charsToTake ? '\n\n[Content truncated...]' : ''}`
        );
        totalChars += truncatedContent.length;
        console.log(`[Vault AI] Added ${truncatedContent.length} chars from ${result.fileName}, total: ${totalChars}`);
      }
    }

    // Step 3: If we have context, ask the LLM to answer
    if (collectedContext.length > 0) {
      console.log('[Vault AI] Generating answer from', collectedContext.length, 'sources');

      steps.push({
        iteration: 3,
        action: 'Generate answer',
        reasoning: `Synthesizing answer from ${collectedContext.length} source(s)`,
        results: [],
      });

      const answerPrompt = this.buildAnswerPrompt(userQuery, collectedContext);

      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: `You are a helpful assistant that answers questions based on the user's personal notes.
Be concise and helpful. When answering:
- Directly answer the question based on the provided notes
- Mention which notes contain the relevant information
- If the notes don't contain enough information to fully answer, say so
- Do not make up information that isn't in the notes`,
        },
        {
          role: 'user',
          content: answerPrompt,
        },
      ];

      try {
        const answer = await this.plugin.llmClient?.chat(messages);
        console.log('[Vault AI] Got answer:', answer?.slice(0, 100) + '...');

        return {
          answer: answer || 'Unable to generate an answer.',
          sources: Array.from(collectedSources),
          steps,
        };
      } catch (error) {
        console.error('[Vault AI] Error generating answer:', error);
        return {
          answer: `I found relevant notes but encountered an error generating the answer: ${error}`,
          sources: Array.from(collectedSources),
          steps,
        };
      }
    }

    // No results found
    console.log('[Vault AI] No relevant content found');
    return {
      answer: `I couldn't find any notes matching "${userQuery}" in ${this.getScopeDescription(scope)}. Try:\n- Using different search terms\n- Expanding the search scope\n- Checking if the information exists in your vault`,
      sources: [],
      steps,
    };
  }

  private extractSearchTerms(query: string): string[] {
    // Remove common stop words and extract meaningful terms
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare',
      'ought', 'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above',
      'below', 'between', 'under', 'again', 'further', 'then', 'once',
      'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few',
      'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
      'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but',
      'if', 'or', 'because', 'until', 'while', 'what', 'which', 'who',
      'whom', 'this', 'that', 'these', 'those', 'am', 'i', 'my', 'me',
      'you', 'your', 'we', 'our', 'they', 'their', 'it', 'its', 'using',
      'currently', 'about', 'tell', 'show', 'find', 'get', 'give'
    ]);

    const words = query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Return unique terms, prioritizing longer words
    const uniqueTerms = [...new Set(words)];
    return uniqueTerms.sort((a, b) => b.length - a.length).slice(0, 5);
  }

  private buildAnswerPrompt(query: string, context: string[]): string {
    const contextText = context.join('\n\n---\n\n');

    return `Based on the following notes from my vault, please answer this question: "${query}"

--- NOTES FROM VAULT ---

${contextText}

--- END OF NOTES ---

Please answer the question based only on the information found in these notes. If the notes don't contain enough information, let me know what's missing.`;
  }

  private getScopeDescription(scope: ContextScope): string {
    const descriptions: Record<ContextScope, string> = {
      current: 'the current note',
      linked: 'linked notes',
      folder: 'the current folder',
      vault: 'your entire vault',
    };
    return descriptions[scope];
  }
}
