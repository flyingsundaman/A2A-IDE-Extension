"use strict";

const vscode = require("vscode");

class SquadWebviewProvider {
  constructor(extensionUri, orchestrator) {
    this.extensionUri = extensionUri;
    this.orchestrator = orchestrator;
    this.view = null;

    // Forward orchestrator events to webview
    this.orchestrator.on("agentMessage", (msg) => {
      this.postMessage({ type: "agentMessage", message: msg });
    });

    this.orchestrator.on("taskStageChange", (data) => {
      this.postMessage({ type: "taskStageChange", data });
    });

    this.orchestrator.on("agentStatusChange", (data) => {
      this.postMessage({ type: "agentStatusChange", data });
    });
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlContent();

    // Listen to messages from the Webview frontend
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.command) {
        case "sendMessage":
          await this.handleUserMessage(data.text);
          break;
        case "runCouncil":
          await this.handleRunCouncil(data.taskTitle, data.prompt);
          break;
        case "setObsidianPath":
          await this.handleSetObsidianPath();
          break;
        case "refreshHealth":
          await this.sendHealthStatus();
          break;
      }
    });

    this.sendHealthStatus();
  }

  postMessage(msg) {
    if (this.view) {
      this.view.webview.postMessage(msg);
    }
  }

  async sendHealthStatus() {
    const agents = await this.orchestrator.registry.refreshHealth();
    const isObsidianConfigured = this.orchestrator.obsidian.isConfigured();
    this.postMessage({
      type: "healthUpdate",
      agents,
      obsidian: {
        configured: isObsidianConfigured,
        vaultPath: this.orchestrator.obsidian.vaultPath
      }
    });
  }

  async handleUserMessage(text) {
    if (!text || !text.trim()) return;

    // Get active editor context if available
    const editor = vscode.window.activeTextEditor;
    const selectedCode = editor ? editor.document.getText(editor.selection) : "";
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";

    const lower = text.toLowerCase();

    if (lower.startsWith("@claude")) {
      const cleanPrompt = text.replace(/^@claude\s*/i, "");
      this.postMessage({
        type: "agentMessage",
        message: { sender: "system", name: "A2A Router", role: "Routing", text: "Menghubungi Claude Code..." }
      });
      try {
        const res = await this.orchestrator.consultAgent("claude-code", cleanPrompt, selectedCode, workspaceRoot);
        this.postMessage({
          type: "agentMessage",
          message: { sender: "claude-code", name: "Claude Code", role: "Architect", text: res.text }
        });
      } catch (err) {
        this.postMessage({
          type: "agentMessage",
          message: { sender: "claude-code", name: "Claude Code", role: "Error", text: "Gagal: " + err.message }
        });
      }
    } else if (lower.startsWith("@codex")) {
      const cleanPrompt = text.replace(/^@codex\s*/i, "");
      this.postMessage({
        type: "agentMessage",
        message: { sender: "system", name: "A2A Router", role: "Routing", text: "Menghubungi OpenAI Codex..." }
      });
      try {
        const res = await this.orchestrator.consultAgent("openai-codex", cleanPrompt, selectedCode, workspaceRoot);
        this.postMessage({
          type: "agentMessage",
          message: { sender: "openai-codex", name: "OpenAI Codex", role: "Security QA", text: res.text }
        });
      } catch (err) {
        this.postMessage({
          type: "agentMessage",
          message: { sender: "openai-codex", name: "OpenAI Codex", role: "Error", text: "Gagal: " + err.message }
        });
      }
    } else if (lower.startsWith("@all") || lower.startsWith("@council")) {
      const cleanPrompt = text.replace(/^@(all|council)\s*/i, "");
      await this.orchestrator.runCouncilPipeline("Group Request", cleanPrompt, selectedCode, workspaceRoot);
    } else {
      // General squad broadcast
      await this.orchestrator.runCouncilPipeline("Squad Discussion", text, selectedCode, workspaceRoot);
    }
  }

  async handleRunCouncil(title = "Council Task", prompt = "Analyze and design task") {
    const editor = vscode.window.activeTextEditor;
    const selectedCode = editor ? editor.document.getText(editor.selection) : "";
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    await this.orchestrator.runCouncilPipeline(title, prompt, selectedCode, workspaceRoot);
  }

  async handleSetObsidianPath() {
    const uri = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: "Select Obsidian Vault Folder"
    });

    if (uri && uri[0]) {
      const selectedPath = uri[0].fsPath;
      const config = vscode.workspace.getConfiguration("a2a");
      await config.update("obsidianVaultPath", selectedPath, vscode.ConfigurationTarget.Global);
      this.orchestrator.updateConfig({ obsidianVaultPath: selectedPath });
      vscode.window.showInformationMessage(`Obsidian Vault connected: ${selectedPath}`);
      this.sendHealthStatus();
    }
  }

  getHtmlContent() {
    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: var(--vscode-editor-background, #121215);
      --fg: var(--vscode-editor-foreground, #f4f4f5);
      --card: var(--vscode-sideBar-background, #18181f);
      --border: var(--vscode-panel-border, #2a2a35);
      --primary: var(--vscode-button-background, #0e639c);
      --primary-hover: var(--vscode-button-hoverBackground, #1177bb);
      --btn-fg: var(--vscode-button-foreground, #ffffff);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--fg);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    /* Top Header */
    .header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      background: var(--card);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .title { font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; }
    .badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 12px;
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .obs-btn {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 6px;
      background: rgba(168, 85, 247, 0.15);
      color: #c084fc;
      border: 1px solid rgba(168, 85, 247, 0.3);
      cursor: pointer;
    }
    /* Status Matrix (Paperclip Style) */
    .status-matrix {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      background: rgba(0,0,0,0.2);
    }
    .agent-card {
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--card);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .agent-name { font-weight: 600; font-size: 11px; }
    .agent-state { font-size: 9px; opacity: 0.8; font-family: monospace; }
    /* Chat Stream */
    .chat-feed {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .message {
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }
    .avatar {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      flex-shrink: 0;
      background: #333;
    }
    .msg-body {
      flex: 1;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 11.5px;
      line-height: 1.45;
    }
    .msg-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
      font-weight: 600;
    }
    .msg-role { font-size: 9px; opacity: 0.65; font-weight: normal; }
    /* Bottom Controls */
    .controls {
      padding: 8px 12px;
      border-top: 1px solid var(--border);
      background: var(--card);
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .tags {
      display: flex;
      gap: 6px;
    }
    .tag-btn {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: inherit;
      cursor: pointer;
    }
    .input-row {
      display: flex;
      gap: 6px;
    }
    .input-box {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--fg);
      padding: 7px 10px;
      border-radius: 6px;
      font-size: 12px;
      outline: none;
    }
    .send-btn {
      background: var(--primary);
      color: var(--btn-fg);
      border: none;
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
    }
    .send-btn:hover { background: var(--primary-hover); }
  </style>
</head>
<body>

  <div class="header">
    <div class="title">
      <span>⚡</span> A2A Agent Squad
      <span class="badge" id="squad-status">Online</span>
    </div>
    <button class="obs-btn" id="obsidian-btn" onclick="setObsidian()">
      📓 Obsidian: Set Vault
    </button>
  </div>

  <!-- Status Matrix -->
  <div class="status-matrix">
    <div class="agent-card" id="card-claude">
      <span class="agent-name" style="color: #fbbf24;">🤖 Claude Code</span>
      <span class="agent-state" id="state-claude">IDLE (Pro)</span>
    </div>
    <div class="agent-card" id="card-codex">
      <span class="agent-name" style="color: #c084fc;">🛡️ Codex</span>
      <span class="agent-state" id="state-codex">IDLE (QA)</span>
    </div>
    <div class="agent-card" id="card-agy">
      <span class="agent-name" style="color: #60a5fa;">🌟 AGY Peer</span>
      <span class="agent-state" id="state-agy">READY</span>
    </div>
  </div>

  <!-- Messages Feed -->
  <div class="chat-feed" id="chat-feed">
    <div class="message">
      <div class="avatar" style="background: #2563eb;">⚡</div>
      <div class="msg-body">
        <div class="msg-header">
          <span>A2A Conductor</span>
          <span class="msg-role">Orchestrator</span>
        </div>
        <p>A2A Mesh siap. Tag <code style="color:#fbbf24;">@Claude</code>, <code style="color:#c084fc;">@Codex</code>, atau <code style="color:#60a5fa;">@all</code> untuk memulai task.</p>
      </div>
    </div>
  </div>

  <!-- Controls -->
  <div class="controls">
    <div class="tags">
      <button class="tag-btn" onclick="tag('@all ')">@all</button>
      <button class="tag-btn" onclick="tag('@Claude ')">@Claude</button>
      <button class="tag-btn" onclick="tag('@Codex ')">@Codex</button>
      <button class="tag-btn" onclick="runCouncil()">🏛️ Run Council</button>
    </div>
    <div class="input-row">
      <input type="text" id="user-input" class="input-box" placeholder="Ketik pesan atau tag agen..." onkeydown="if(event.key==='Enter') send()" />
      <button class="send-btn" onclick="send()">Kirim</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    function tag(text) {
      const input = document.getElementById('user-input');
      input.value = text + input.value;
      input.focus();
    }

    function send() {
      const input = document.getElementById('user-input');
      const text = input.value.trim();
      if (!text) return;

      appendMessage({
        sender: 'user',
        name: 'You (Tech Lead)',
        role: 'Human',
        text: text
      });

      vscode.postMessage({ command: 'sendMessage', text: text });
      input.value = '';
    }

    function runCouncil() {
      vscode.postMessage({
        command: 'runCouncil',
        taskTitle: 'Manual Council Trigger',
        prompt: 'Review active selection or git diff'
      });
    }

    function setObsidian() {
      vscode.postMessage({ command: 'setObsidianPath' });
    }

    function appendMessage(msg) {
      const feed = document.getElementById('chat-feed');
      const div = document.createElement('div');
      div.className = 'message';

      let icon = '⚡';
      let color = '#2563eb';
      if (msg.sender === 'claude-code') { icon = '🤖'; color = '#d97706'; }
      else if (msg.sender === 'openai-codex') { icon = '🛡️'; color = '#7c3aed'; }
      else if (msg.sender === 'user') { icon = '👤'; color = '#059669'; }

      div.innerHTML = \`
        <div class="avatar" style="background: \${color};">\${icon}</div>
        <div class="msg-body">
          <div class="msg-header">
            <span>\${escapeHtml(msg.name)}</span>
            <span class="msg-role">\${escapeHtml(msg.role || '')}</span>
          </div>
          <div style="white-space: pre-wrap;">\${escapeHtml(msg.text)}</div>
        </div>
      \`;
      feed.appendChild(div);
      feed.scrollTop = feed.scrollHeight;
    }

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'agentMessage') {
        appendMessage(msg.message);
      } else if (msg.type === 'healthUpdate') {
        if (msg.obsidian && msg.obsidian.configured) {
          const btn = document.getElementById('obsidian-btn');
          btn.textContent = '📓 Vault: Connected';
          btn.style.color = '#34d399';
        }
      }
    });

    function escapeHtml(str) {
      if (!str) return '';
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  </script>
</body>
</html>`;
  }
}

module.exports = { SquadWebviewProvider };
