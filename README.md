# Vault AI - Obsidian Plugin

An Obsidian plugin that provides AI-assisted vault management using local LLMs (Ollama or LM Studio).

## Features

### Chat
Ask questions about your vault with intelligent search across different scopes:
- Current note
- Linked notes
- Current folder
- Entire vault

### Format (Coming Soon)
Analyze notes for markdown best practices with preview and apply suggestions.

### Structure (Coming Soon)
AI-powered suggestions for vault reorganization with safe execution and undo.

## Requirements

- Obsidian v1.4.0 or higher
- A local LLM server:
  - [Ollama](https://ollama.ai) (default: http://localhost:11434)
  - [LM Studio](https://lmstudio.ai) (default: http://localhost:1234)

## Installation

### Manual Installation

1. Download the latest release (`main.js`, `manifest.json`, `styles.css`)
2. Create a folder `vault-ai` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the folder
4. Enable the plugin in Obsidian Settings → Community Plugins

### Building from Source

```bash
# Clone the repository
git clone https://github.com/user/vault-ai.git
cd vault-ai

# Install dependencies
npm install

# Build
npm run build

# Copy to your vault
cp main.js manifest.json styles.css /path/to/vault/.obsidian/plugins/vault-ai/
```

## Configuration

1. Open Settings → Vault AI
2. Select your LLM server type (Ollama or LM Studio)
3. Verify the server URL
4. Click "Refresh Models" to load available models
5. Select a model

## Usage

1. Click the brain icon in the left ribbon or use the command palette
2. Type your question in the chat input
3. Select the context scope (current note, linked, folder, or vault)
4. Press Enter or click Send

## Development

```bash
# Install dependencies
npm install

# Development build with watch
npm run dev

# Production build
npm run build
```

## License

MIT
