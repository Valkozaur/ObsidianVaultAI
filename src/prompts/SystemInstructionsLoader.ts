import { App, TFile } from 'obsidian';

/**
 * Loads custom system instructions from a file in the vault
 * Similar to how Agent.md or System.md files work in other tools
 */
export class SystemInstructionsLoader {
  constructor(private app: App) {}

  /**
   * Load system instructions from a file in the vault
   * @param path Path to the instructions file (e.g., "Agent.md" or "System/Instructions.md")
   * @returns The file content, or null if file doesn't exist
   */
  async load(path: string): Promise<string | null> {
    if (!path) return null;

    // Normalize path - add .md if not present
    let normalizedPath = path.trim();
    if (!normalizedPath.endsWith('.md')) {
      normalizedPath += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);

    if (!file || !(file instanceof TFile)) {
      // Try without .md if it was added
      if (path.endsWith('.md')) {
        return null;
      }
      const altFile = this.app.vault.getAbstractFileByPath(path);
      if (!altFile || !(altFile instanceof TFile)) {
        return null;
      }
      return await this.app.vault.read(altFile);
    }

    return await this.app.vault.read(file);
  }

  /**
   * Get the effective system prompt by combining base prompt with custom instructions
   * @param basePrompt The default system prompt
   * @param instructionsPath Path to the custom instructions file
   * @returns Combined system prompt
   */
  async getEffectiveSystemPrompt(basePrompt: string, instructionsPath: string): Promise<string> {
    const customInstructions = await this.load(instructionsPath);

    if (!customInstructions) {
      return basePrompt;
    }

    // Parse and process the instructions file
    const processed = this.processInstructions(customInstructions);

    return `${basePrompt}

## Custom Instructions from ${instructionsPath}

${processed}`;
  }

  /**
   * Process the instructions file content
   * Handles special directives and formatting
   */
  private processInstructions(content: string): string {
    // Remove frontmatter if present
    let processed = content;
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
    if (frontmatterMatch) {
      processed = content.slice(frontmatterMatch[0].length);
    }

    // Trim whitespace
    processed = processed.trim();

    return processed;
  }

  /**
   * Check if the instructions file exists
   */
  async exists(path: string): Promise<boolean> {
    if (!path) return false;

    let normalizedPath = path.trim();
    if (!normalizedPath.endsWith('.md')) {
      normalizedPath += '.md';
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    return file instanceof TFile;
  }

  /**
   * Create a default instructions file if it doesn't exist
   */
  async createDefaultIfNotExists(path: string): Promise<boolean> {
    if (await this.exists(path)) {
      return false;
    }

    let normalizedPath = path.trim();
    if (!normalizedPath.endsWith('.md')) {
      normalizedPath += '.md';
    }

    const defaultContent = `# Agent Instructions

This file contains custom instructions for the Vault AI agent. The content of this file will be appended to the system prompt.

## Guidelines

- Be helpful and concise
- When searching the vault, prefer to search by topic rather than exact phrases
- When creating notes, follow the existing naming conventions in the vault
- Prefer to use existing folder structures rather than creating new ones

## Context

Add any specific context about your vault here:

- Main topics:
- Preferred formatting:
- Special conventions:

---
*Edit this file to customize how the AI assistant behaves in your vault.*
`;

    try {
      await this.app.vault.create(normalizedPath, defaultContent);
      return true;
    } catch (error) {
      console.error('[Vault AI] Failed to create default instructions file:', error);
      return false;
    }
  }
}
