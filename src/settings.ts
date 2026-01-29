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

    // LM Studio-specific settings (shown only when LM Studio is selected)
    if (this.plugin.settings.serverType === 'lmstudio') {
      containerEl.createEl('h3', { text: 'LM Studio Settings' });

      // Context Length
      new Setting(containerEl)
        .setName('Context Length')
        .setDesc('Number of tokens to use as context. Higher values recommended for MCP tool usage (2000-32000).')
        .addText((text) =>
          text
            .setPlaceholder('8000')
            .setValue(String(this.plugin.settings.lmStudioContextLength))
            .onChange(async (value) => {
              const num = parseInt(value);
              if (!isNaN(num) && num >= 1000 && num <= 128000) {
                this.plugin.settings.lmStudioContextLength = num;
                await this.plugin.saveSettings();
              }
            })
        );

      // Reasoning Level
      new Setting(containerEl)
        .setName('Reasoning Level')
        .setDesc('Control the model\'s reasoning/thinking depth. "Auto" uses the model\'s default.')
        .addDropdown((dropdown) =>
          dropdown
            .addOption('auto', 'Auto (model default)')
            .addOption('off', 'Off')
            .addOption('low', 'Low')
            .addOption('medium', 'Medium')
            .addOption('high', 'High')
            .addOption('on', 'On (maximum)')
            .setValue(this.plugin.settings.lmStudioReasoning)
            .onChange(async (value: 'off' | 'low' | 'medium' | 'high' | 'on' | 'auto') => {
              this.plugin.settings.lmStudioReasoning = value;
              await this.plugin.saveSettings();
            })
        );

      // MCP Integration Section
      containerEl.createEl('h4', { text: 'MCP Integrations' });

      const mcpInfo = containerEl.createDiv('vault-ai-mcp-info');
      mcpInfo.createEl('p', {
        text: 'Configure MCP (Model Context Protocol) servers for tool capabilities. Tools will be executed by LM Studio.',
        cls: 'vault-ai-info-text setting-item-description',
      });

      // LM Studio Plugins
      new Setting(containerEl)
        .setName('LM Studio MCP Plugins')
        .setDesc('Comma-separated list of MCP plugin IDs installed in LM Studio (e.g., "mcp/playwright, mcp/filesystem")')
        .addText((text) =>
          text
            .setPlaceholder('mcp/plugin-name')
            .setValue(this.plugin.settings.mcpPlugins.join(', '))
            .onChange(async (value) => {
              this.plugin.settings.mcpPlugins = value
                .split(',')
                .map(s => s.trim())
                .filter(s => s.length > 0);
              await this.plugin.saveSettings();
            })
        );

      // External MCP Servers
      new Setting(containerEl)
        .setName('External MCP Servers')
        .setDesc('Add external MCP servers (e.g., Hugging Face MCP)');

      const mcpContainer = containerEl.createDiv('vault-ai-mcp-servers');
      this.renderMCPServerList(mcpContainer);

      new Setting(containerEl)
        .addButton((button) =>
          button
            .setButtonText('Add MCP Server')
            .onClick(async () => {
              this.plugin.settings.mcpServers.push({
                label: 'new-server',
                url: 'https://example.com/mcp',
              });
              await this.plugin.saveSettings();
              this.renderMCPServerList(mcpContainer);
            })
        );
    }

    // Agent Mode Section
    containerEl.createEl('h3', { text: 'Agent Capabilities' });

    // Enable Agent Mode
    new Setting(containerEl)
      .setName('Enable Agent Mode')
      .setDesc('Allow the AI to perform actions like creating notes, modifying files, etc. When disabled, the AI can only search and read your vault.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableAgentMode)
          .onChange(async (value) => {
            this.plugin.settings.enableAgentMode = value;
            await this.plugin.saveSettings();
          })
      );

    const agentInfo = containerEl.createDiv('vault-ai-agent-info');
    agentInfo.createEl('p', {
      text: 'With Agent Mode enabled, you can ask the AI to:',
      cls: 'vault-ai-info-header',
    });
    const featureList = agentInfo.createEl('ul');
    featureList.createEl('li', { text: 'Create new notes in specific folders' });
    featureList.createEl('li', { text: 'Append content to existing notes' });
    featureList.createEl('li', { text: 'Search and read notes' });
    featureList.createEl('li', { text: 'List folder contents' });

    // Built-in MCP Server Section
    containerEl.createEl('h3', { text: 'Built-in MCP Server' });

    const mcpServerInfo = containerEl.createDiv('vault-ai-mcp-server-info');
    mcpServerInfo.createEl('p', {
      text: 'The built-in MCP server exposes Obsidian vault tools (search, read, create notes) to LMStudio. This enables native tool calling without external MCP servers.',
      cls: 'vault-ai-info-text setting-item-description',
    });

    // Enable MCP Server
    new Setting(containerEl)
      .setName('Enable Built-in MCP Server')
      .setDesc('Run a local MCP server that exposes vault tools to LMStudio')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.mcpServerEnabled)
          .onChange(async (value) => {
            this.plugin.settings.mcpServerEnabled = value;
            await this.plugin.saveSettings();
            // Restart MCP server if needed
            if (value) {
              await this.plugin.startMCPServer();
            } else {
              await this.plugin.stopMCPServer();
            }
          })
      );

    // MCP Server Port
    new Setting(containerEl)
      .setName('MCP Server Port')
      .setDesc('Port for the built-in MCP server (requires restart to take effect)')
      .addText((text) =>
        text
          .setPlaceholder('3456')
          .setValue(String(this.plugin.settings.mcpServerPort))
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num >= 1024 && num <= 65535) {
              this.plugin.settings.mcpServerPort = num;
              await this.plugin.saveSettings();
            }
          })
      );

    // System Instructions Section
    containerEl.createEl('h3', { text: 'System Instructions' });

    const instructionsInfo = containerEl.createDiv('vault-ai-instructions-info');
    instructionsInfo.createEl('p', {
      text: 'Load custom system instructions from a file in your vault (e.g., Agent.md). These instructions are appended to the default system prompt.',
      cls: 'vault-ai-info-text setting-item-description',
    });

    // Enable System Instructions
    new Setting(containerEl)
      .setName('Use Custom System Instructions')
      .setDesc('Load additional system instructions from a file in your vault')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.useSystemInstructions)
          .onChange(async (value) => {
            this.plugin.settings.useSystemInstructions = value;
            await this.plugin.saveSettings();
          })
      );

    // System Instructions File Path
    new Setting(containerEl)
      .setName('System Instructions File')
      .setDesc('Path to a markdown file containing custom system instructions (e.g., "Agent.md" or "System/Prompt.md")')
      .addText((text) =>
        text
          .setPlaceholder('Agent.md')
          .setValue(this.plugin.settings.systemInstructionsPath)
          .onChange(async (value) => {
            this.plugin.settings.systemInstructionsPath = value;
            await this.plugin.saveSettings();
          })
      )
      .addButton((button) =>
        button
          .setButtonText('Create Default')
          .setTooltip('Create a default instructions file if it doesn\'t exist')
          .onClick(async () => {
            const { SystemInstructionsLoader } = await import('./prompts/SystemInstructionsLoader');
            const loader = new SystemInstructionsLoader(this.app);
            const created = await loader.createDefaultIfNotExists(this.plugin.settings.systemInstructionsPath);
            if (created) {
              new Notice(`Created ${this.plugin.settings.systemInstructionsPath}`);
            } else {
              new Notice('File already exists');
            }
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

  private renderMCPServerList(container: HTMLElement): void {
    container.empty();

    if (this.plugin.settings.mcpServers.length === 0) {
      container.createEl('p', {
        text: 'No external MCP servers configured.',
        cls: 'vault-ai-mcp-empty',
      });
      return;
    }

    for (let i = 0; i < this.plugin.settings.mcpServers.length; i++) {
      const server = this.plugin.settings.mcpServers[i];
      const serverEl = container.createDiv('vault-ai-mcp-server-item');

      new Setting(serverEl)
        .setName(`Server ${i + 1}`)
        .addText((text) =>
          text
            .setPlaceholder('Label')
            .setValue(server.label)
            .onChange(async (value) => {
              this.plugin.settings.mcpServers[i].label = value;
              await this.plugin.saveSettings();
            })
        )
        .addText((text) =>
          text
            .setPlaceholder('URL')
            .setValue(server.url)
            .onChange(async (value) => {
              this.plugin.settings.mcpServers[i].url = value;
              await this.plugin.saveSettings();
            })
        )
        .addButton((button) =>
          button
            .setIcon('trash')
            .setTooltip('Remove server')
            .onClick(async () => {
              this.plugin.settings.mcpServers.splice(i, 1);
              await this.plugin.saveSettings();
              this.renderMCPServerList(container);
            })
        );
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
