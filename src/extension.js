"use strict";

const vscode = require("vscode");
const { Orchestrator } = require("./core/orchestrator");
const { SquadWebviewProvider } = require("./ui/squadWebview");
const { A2AStatusBar } = require("./ui/statusBar");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  const config = vscode.workspace.getConfiguration("a2a");
  const orchestrator = new Orchestrator({
    obsidianVaultPath: config.get("obsidianVaultPath", ""),
    claudeCliPath: config.get("claudeCliPath", "C:\\Users\\acer\\.local\\bin\\claude.exe"),
    codexCliPath: config.get("codexCliPath", "C:\\Users\\acer\\AppData\\Local\\OpenAI\\Codex\\bin\\2993767bd1dfb009\\codex.exe")
  });

  // Watch for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("a2a")) {
        const updated = vscode.workspace.getConfiguration("a2a");
        orchestrator.updateConfig({
          obsidianVaultPath: updated.get("obsidianVaultPath", "")
        });
      }
    })
  );

  // Status Bar
  const statusBar = new A2AStatusBar(orchestrator);
  context.subscriptions.push(statusBar);

  // Webview Sidebar View
  const webviewProvider = new SquadWebviewProvider(context.extensionUri, orchestrator);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("a2a.squadView", webviewProvider)
  );

  // Command: Open Squad
  context.subscriptions.push(
    vscode.commands.registerCommand("a2a.openSquad", () => {
      vscode.commands.executeCommand("workbench.view.extension.a2a-sidebar");
    })
  );

  // Command: Consult Claude Code
  context.subscriptions.push(
    vscode.commands.registerCommand("a2a.askClaude", async () => {
      const editor = vscode.window.activeTextEditor;
      const selectedCode = editor ? editor.document.getText(editor.selection) : "";
      const prompt = await vscode.window.showInputBox({
        prompt: "Apa yang ingin Anda konsultasikan ke Claude Architect?",
        placeHolder: "Misal: Rancang interface modular untuk fitur ini..."
      });
      if (!prompt) return;

      vscode.commands.executeCommand("a2a.openSquad");
      webviewProvider.postMessage({
        type: "agentMessage",
        message: { sender: "user", name: "You (Tech Lead)", role: "Human", text: `@Claude ${prompt}` }
      });
      await webviewProvider.handleUserMessage(`@Claude ${prompt}`);
    })
  );

  // Command: Audit with Codex
  context.subscriptions.push(
    vscode.commands.registerCommand("a2a.auditCodex", async () => {
      const editor = vscode.window.activeTextEditor;
      const selectedCode = editor ? editor.document.getText(editor.selection) : "";
      const prompt = await vscode.window.showInputBox({
        prompt: "Fokus audit keamanan Codex:",
        value: "Audit celah keamanan, race conditions, dan edge cases."
      });
      if (!prompt) return;

      vscode.commands.executeCommand("a2a.openSquad");
      webviewProvider.postMessage({
        type: "agentMessage",
        message: { sender: "user", name: "You (Tech Lead)", role: "Human", text: `@Codex ${prompt}` }
      });
      await webviewProvider.handleUserMessage(`@Codex ${prompt}`);
    })
  );

  // Command: Run Council
  context.subscriptions.push(
    vscode.commands.registerCommand("a2a.runCouncil", async () => {
      const title = await vscode.window.showInputBox({
        prompt: "Judul Task / Fitur:",
        placeHolder: "Misal: Implementasi Idempotent Webhook"
      });
      if (!title) return;

      const prompt = await vscode.window.showInputBox({
        prompt: "Deskripsi Kebutuhan:",
        placeHolder: "Jelaskan requirements untuk didiskusikan oleh Claude & Codex..."
      });
      if (!prompt) return;

      vscode.commands.executeCommand("a2a.openSquad");
      await webviewProvider.handleRunCouncil(title, prompt);
    })
  );

  // Command: Sync Obsidian
  context.subscriptions.push(
    vscode.commands.registerCommand("a2a.syncObsidian", async () => {
      await webviewProvider.handleSetObsidianPath();
    })
  );

  // Command: Refresh Quotas
  context.subscriptions.push(
    vscode.commands.registerCommand("a2a.refreshQuotas", async () => {
      await webviewProvider.sendHealthStatus();
      vscode.window.showInformationMessage("A2A Mesh: Quota dan status agen berhasil diperbarui.");
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
