import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type VaultAIPlugin from './main';
import { DEFAULT_SYSTEM_PROMPT } from './types';

export class VaultAISettingTab extends PluginSettingTab {
  plugin: VaultAIPlugin;
  private modelDropdown: HTMLSelectElement | null = null;

  constructor(app: App, plugin: VaultAIPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('vault-ai-settings');

    // Header
    const header = containerEl.createDiv('vault-ai-settings-header');
    header.createEl('h2', { text: 'Vault AI' });
    const subtitle = header.createEl('p', { cls: 'vault-ai-settings-subtitle' });
    subtitle.setText('Configure your AI assistant for Obsidian');

    // Status Cards
    this.renderStatusCards(containerEl);

    // Connection Section
    this.renderConnectionSection(containerEl);

    // System Prompt Section
    this.renderSystemPromptSection(containerEl);

    // Advanced Section
    this.renderAdvancedSection(containerEl);
  }

  private renderStatusCards(container: HTMLElement): void {
    const cardsContainer = container.createDiv('vault-ai-status-cards');

    // LM Studio Status
    const lmCard = cardsContainer.createDiv('vault-ai-status-card');
    const lmIcon = lmCard.createDiv('vault-ai-status-card-icon');
    lmIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 6v10"/><path d="m15.5 3.5-7 7"/><path d="m19.5 7.5-15 9"/><path d="m23 12h-6m-6 0H1"/><path d="m19.5 16.5-15-9"/><path d="m15.5 20.5-7-7"/></svg>`;
    const lmContent = lmCard.createDiv('vault-ai-status-card-content');
    lmContent.createEl('span', { text: 'LM Studio', cls: 'vault-ai-status-card-label' });
    const lmStatus = lmContent.createEl('span', { cls: 'vault-ai-status-card-value' });

    this.plugin.llmClient?.isConnected().then(connected => {
      if (connected) {
        lmStatus.setText('Connected');
        lmStatus.addClass('status-connected');
        lmCard.addClass('connected');
      } else {
        lmStatus.setText('Disconnected');
        lmStatus.addClass('status-disconnected');
      }
    }).catch(() => {
      lmStatus.setText('Disconnected');
      lmStatus.addClass('status-disconnected');
    });

    // MCP Status
    const mcpCard = cardsContainer.createDiv('vault-ai-status-card');
    const mcpIcon = mcpCard.createDiv('vault-ai-status-card-icon');
    mcpIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="7.5 4.21 12 6.81 16.5 4.21"/><polyline points="7.5 19.79 7.5 14.6 3 12"/><polyline points="21 12 16.5 14.6 16.5 19.79"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
    const mcpContent = mcpCard.createDiv('vault-ai-status-card-content');
    mcpContent.createEl('span', { text: 'MCP Server', cls: 'vault-ai-status-card-label' });
    const mcpStatus = mcpContent.createEl('span', { cls: 'vault-ai-status-card-value' });

    if (this.plugin.settings.mcpEnabled && this.plugin.mcpServer?.isRunning()) {
      mcpStatus.setText(`Port ${this.plugin.settings.mcpPort}`);
      mcpStatus.addClass('status-connected');
      mcpCard.addClass('connected');
    } else if (this.plugin.settings.mcpEnabled) {
      mcpStatus.setText('Starting...');
      mcpStatus.addClass('status-warning');
    } else {
      mcpStatus.setText('Disabled');
      mcpStatus.addClass('status-disabled');
    }

    // Model Status
    const modelCard = cardsContainer.createDiv('vault-ai-status-card');
    const modelIcon = modelCard.createDiv('vault-ai-status-card-icon');
    modelIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 1 0 8 8"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/></svg>`;
    const modelContent = modelCard.createDiv('vault-ai-status-card-content');
    modelContent.createEl('span', { text: 'Model', cls: 'vault-ai-status-card-label' });
    const modelStatus = modelContent.createEl('span', { cls: 'vault-ai-status-card-value' });

    if (this.plugin.settings.selectedModel) {
      const modelName = this.plugin.settings.selectedModel.split('/').pop() || this.plugin.settings.selectedModel;
      modelStatus.setText(modelName.length > 20 ? modelName.slice(0, 20) + '...' : modelName);
      modelStatus.addClass('status-connected');
      modelCard.addClass('connected');
    } else {
      modelStatus.setText('Not selected');
      modelStatus.addClass('status-warning');
    }
  }

  private renderConnectionSection(container: HTMLElement): void {
    const section = container.createDiv('vault-ai-settings-section');
    section.createEl('h3', { text: 'Connection', cls: 'vault-ai-settings-section-title' });

    // Server URL
    new Setting(section)
      .setName('LM Studio URL')
      .setDesc('URL of your LM Studio server')
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:1234')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value;
            await this.plugin.saveSettings();
          })
      );

    // Model Selection
    const modelSetting = new Setting(section)
      .setName('Model')
      .setDesc('Select the AI model to use');

    modelSetting.addDropdown((dropdown) => {
      this.modelDropdown = dropdown.selectEl;
      dropdown.addOption('', 'Select a model...');

      if (this.plugin.settings.selectedModel) {
        dropdown.addOption(
          this.plugin.settings.selectedModel,
          this.plugin.settings.selectedModel
        );
        dropdown.setValue(this.plugin.settings.selectedModel);
      }

      dropdown.onChange(async (value) => {
        this.plugin.settings.selectedModel = value;
        await this.plugin.saveSettings();
        this.display(); // Refresh to update status card
      });
    });

    modelSetting.addButton((button) =>
      button
        .setButtonText('Refresh')
        .onClick(async () => {
          await this.refreshModels();
        })
    );

    // MCP Toggle
    new Setting(section)
      .setName('Enable MCP')
      .setDesc('Allow AI to directly interact with your vault (create notes, search, etc.)')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.mcpEnabled)
          .onChange(async (value) => {
            this.plugin.settings.mcpEnabled = value;
            await this.plugin.saveSettings();
            if (value) {
              await this.plugin.startMCPServer();
            } else {
              await this.plugin.stopMCPServer();
            }
            this.display(); // Refresh to update status card
          })
      );
  }

  private renderSystemPromptSection(container: HTMLElement): void {
    const section = container.createDiv('vault-ai-settings-section');
    section.createEl('h3', { text: 'System Prompt', cls: 'vault-ai-settings-section-title' });

    const promptDesc = section.createEl('p', { cls: 'vault-ai-settings-section-desc' });
    promptDesc.setText('Customize how the AI behaves and responds. This prompt is sent with every message.');

    // System Prompt Textarea
    const promptContainer = section.createDiv('vault-ai-prompt-container');

    const promptTextarea = promptContainer.createEl('textarea', {
      cls: 'vault-ai-system-prompt-input',
      attr: {
        rows: '8',
        placeholder: 'Enter your system prompt...',
        spellcheck: 'false',
      },
    });
    promptTextarea.value = this.plugin.settings.systemPrompt;

    promptTextarea.addEventListener('change', async () => {
      this.plugin.settings.systemPrompt = promptTextarea.value;
      await this.plugin.saveSettings();
    });

    // Reset button
    const promptActions = promptContainer.createDiv('vault-ai-prompt-actions');
    const resetBtn = promptActions.createEl('button', {
      text: 'Reset to default',
      cls: 'vault-ai-reset-prompt-btn',
    });
    resetBtn.addEventListener('click', async () => {
      promptTextarea.value = DEFAULT_SYSTEM_PROMPT;
      this.plugin.settings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
      await this.plugin.saveSettings();
      new Notice('System prompt reset to default');
    });
  }

  private renderAdvancedSection(container: HTMLElement): void {
    const section = container.createDiv('vault-ai-settings-section');

    const headerRow = section.createDiv('vault-ai-settings-section-header-row');
    headerRow.createEl('h3', { text: 'Advanced', cls: 'vault-ai-settings-section-title' });

    // MCP Port
    new Setting(section)
      .setName('MCP Port')
      .setDesc('Port for the MCP server (requires reload)')
      .addText((text) =>
        text
          .setPlaceholder('3456')
          .setValue(String(this.plugin.settings.mcpPort))
          .onChange(async (value) => {
            const port = parseInt(value, 10);
            if (!isNaN(port) && port > 0 && port < 65536) {
              this.plugin.settings.mcpPort = port;
              await this.plugin.saveSettings();
            }
          })
      );

    // Show Thinking
    new Setting(section)
      .setName('Show thinking process')
      .setDesc('Display AI reasoning and tool calls in responses')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showThinkingProcess)
          .onChange(async (value) => {
            this.plugin.settings.showThinkingProcess = value;
            await this.plugin.saveSettings();
          })
      );

    // Available Tools Info
    const toolsInfo = section.createDiv('vault-ai-tools-info');
    toolsInfo.createEl('h4', { text: 'Available Tools' });
    const toolsList = toolsInfo.createDiv('vault-ai-tools-grid');

    const tools = [
      { name: 'search_vault', desc: 'Search notes' },
      { name: 'read_note', desc: 'Read content' },
      { name: 'create_note', desc: 'Create notes' },
      { name: 'append_to_note', desc: 'Append content' },
      { name: 'edit_section', desc: 'Edit sections' },
      { name: 'replace_text', desc: 'Find & replace' },
      { name: 'delete_note', desc: 'Delete notes' },
      { name: 'grep_vault', desc: 'Regex search' },
      { name: 'list_folder', desc: 'List folders' },
      { name: 'create_folder', desc: 'Create folders' },
      { name: 'rename_file', desc: 'Rename files' },
      { name: 'move_file', desc: 'Move files' },
    ];

    for (const tool of tools) {
      const toolEl = toolsList.createDiv('vault-ai-tool-item');
      toolEl.createSpan({ text: tool.name, cls: 'vault-ai-tool-name' });
      toolEl.createSpan({ text: tool.desc, cls: 'vault-ai-tool-desc' });
    }
  }

  private async refreshModels(): Promise<void> {
    if (!this.modelDropdown) return;

    const dropdown = this.modelDropdown;
    dropdown.empty();
    dropdown.createEl('option', { text: 'Loading...', value: '' });

    try {
      if (!this.plugin.llmClient) {
        throw new Error('LLM client not initialized');
      }

      const models = await this.plugin.llmClient.listModels();

      dropdown.empty();
      dropdown.createEl('option', { text: 'Select a model...', value: '' });

      if (models && models.length > 0) {
        for (const model of models) {
          dropdown.createEl('option', { text: model, value: model });
        }

        if (this.plugin.settings.selectedModel) {
          dropdown.value = this.plugin.settings.selectedModel;
        }

        new Notice(`Found ${models.length} model(s)`);
      } else {
        new Notice('No models found. Make sure LM Studio is running.');
      }
    } catch (error) {
      console.error('[Vault AI Settings] Error refreshing models:', error);
      dropdown.empty();
      dropdown.createEl('option', { text: 'Error loading models', value: '' });
      new Notice(`Failed to load models: ${error}`);
    }
  }
}
