import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type VaultAIPlugin from './main';
import { DEFAULT_URLS, ServerType, ContextScope } from './types';

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

    containerEl.createEl('h2', { text: 'Vault AI Settings' });

    // Server Type
    new Setting(containerEl)
      .setName('LLM Server Type')
      .setDesc('Select the local LLM server you are using')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('ollama', 'Ollama')
          .addOption('lmstudio', 'LM Studio')
          .setValue(this.plugin.settings.serverType)
          .onChange(async (value: ServerType) => {
            this.plugin.settings.serverType = value;
            this.plugin.settings.serverUrl = DEFAULT_URLS[value];
            this.plugin.settings.selectedModel = '';
            await this.plugin.saveSettings();
            this.display(); // Refresh to update URL field
          })
      );

    // Server URL
    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('The URL of your local LLM server')
      .addText((text) =>
        text
          .setPlaceholder('http://localhost:11434')
          .setValue(this.plugin.settings.serverUrl)
          .onChange(async (value) => {
            this.plugin.settings.serverUrl = value;
            await this.plugin.saveSettings();
          })
      );

    // Model Selection
    const modelSetting = new Setting(containerEl)
      .setName('Model')
      .setDesc('Select the model to use for AI operations');

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
      });
    });

    modelSetting.addButton((button) =>
      button
        .setButtonText('Refresh Models')
        .setCta()
        .onClick(async () => {
          await this.refreshModels();
        })
    );

    // Default Context Scope
    new Setting(containerEl)
      .setName('Default Context Scope')
      .setDesc('Default scope for chat queries')
      .addDropdown((dropdown) =>
        dropdown
          .addOption('current', 'Current Note')
          .addOption('linked', 'Linked Notes')
          .addOption('folder', 'Current Folder')
          .addOption('vault', 'Entire Vault')
          .setValue(this.plugin.settings.defaultContextScope)
          .onChange(async (value: ContextScope) => {
            this.plugin.settings.defaultContextScope = value;
            await this.plugin.saveSettings();
          })
      );

    // Max Search Iterations
    new Setting(containerEl)
      .setName('Max Search Iterations')
      .setDesc('Maximum number of search iterations for agentic search (1-10)')
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setValue(this.plugin.settings.maxSearchIterations)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxSearchIterations = value;
            await this.plugin.saveSettings();
          })
      );

    // Show Thinking Process
    new Setting(containerEl)
      .setName('Show Thinking Process')
      .setDesc('Display the AI search steps in chat responses')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showThinkingProcess)
          .onChange(async (value) => {
            this.plugin.settings.showThinkingProcess = value;
            await this.plugin.saveSettings();
          })
      );

    // Connection Status
    containerEl.createEl('h3', { text: 'Connection Status' });

    const statusContainer = containerEl.createDiv('vault-ai-status-container');
    this.updateConnectionStatus(statusContainer);
  }

  private async refreshModels(): Promise<void> {
    if (!this.modelDropdown) return;

    const dropdown = this.modelDropdown;
    dropdown.empty();
    dropdown.createEl('option', { text: 'Loading...', value: '' });

    console.log('[Vault AI Settings] Refreshing models...');
    console.log('[Vault AI Settings] Server type:', this.plugin.settings.serverType);
    console.log('[Vault AI Settings] Server URL:', this.plugin.settings.serverUrl);
    console.log('[Vault AI Settings] LLM Client exists:', !!this.plugin.llmClient);

    try {
      if (!this.plugin.llmClient) {
        throw new Error('LLM client not initialized');
      }

      console.log('[Vault AI Settings] Calling listModels()...');
      const models = await this.plugin.llmClient.listModels();
      console.log('[Vault AI Settings] Models received:', models);

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
        new Notice('No models found. Make sure your LLM server is running.');
      }
    } catch (error) {
      console.error('[Vault AI Settings] Error refreshing models:', error);
      dropdown.empty();
      dropdown.createEl('option', { text: 'Error loading models', value: '' });
      new Notice(`Failed to load models: ${error}`);
    }
  }

  private async updateConnectionStatus(container: HTMLElement): Promise<void> {
    container.empty();

    const statusEl = container.createDiv('vault-ai-connection-status');

    try {
      const connected = await this.plugin.llmClient?.isConnected();

      if (connected) {
        statusEl.addClass('connected');
        statusEl.createSpan({ text: '● Connected to ' });
        statusEl.createSpan({
          text: this.plugin.settings.serverType === 'ollama' ? 'Ollama' : 'LM Studio',
          cls: 'server-name',
        });
      } else {
        statusEl.addClass('disconnected');
        statusEl.createSpan({ text: '○ Disconnected' });
      }
    } catch {
      statusEl.addClass('disconnected');
      statusEl.createSpan({ text: '○ Unable to connect' });
    }

    const refreshBtn = container.createEl('button', {
      text: 'Test Connection',
      cls: 'vault-ai-test-connection',
    });

    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Testing...';
      await this.updateConnectionStatus(container);
    });
  }
}
