"use strict";
const vscode = require("vscode");
const { Store } = require("./runtime/store");
const { Mesh } = require("./runtime/mesh");
const { SquadWebviewProvider } = require("./ui/squadWebview");
function activate(context) {
  const store = new Store(context.globalStorageUri.fsPath);
  const mesh = new Mesh(store, {
    getSecret: (key) => context.secrets.get(key),
    trusted: () => vscode.workspace.isTrusted,
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
    confirm: async (message) =>
      (await vscode.window.showWarningMessage(
        message,
        { modal: true },
        "Allow",
      )) === "Allow",
  });
  const provider = new SquadWebviewProvider(context, mesh);
  context.subscriptions.push(mesh, provider);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("a2a.squadView", provider),
  );
  const register = (name, fn) =>
    context.subscriptions.push(vscode.commands.registerCommand(name, fn));
  register("a2a.openSquad", () =>
    provider.open(store.data.agents.length ? "chat" : "agents"),
  );
  register("a2a.openAgents", () => provider.open("agents"));
  register("a2a.runCouncil", () => provider.open("tasks"));
  register("a2a.syncObsidian", () => provider.open("knowledge"));
  register("a2a.refreshQuotas", async () => {
    for (const c of store.data.connections) await mesh.testConnection(c.id);
  });
  async function selection(role) {
    const agents = store.data.agents;
    if (!agents.length) return provider.open("agents");
    const chosen = await vscode.window.showQuickPick(
      agents.map((a) => ({ label: a.name, description: a.role, id: a.id })),
      { title: "Choose " + role + " agent" },
    );
    if (!chosen) return;
    const prompt = await vscode.window.showInputBox({
      prompt:
        role === "review"
          ? "What should be reviewed?"
          : "What would you like to ask?",
    });
    if (!prompt) return;
    provider.open("tasks");
    const editor = vscode.window.activeTextEditor;
    const code = editor?.document.getText(editor.selection) || "";
    await mesh.execute({
      title: role + " selection",
      prompt: prompt + (code ? "\n\nSelected code:\n" + code : ""),
      agentIds: [chosen.id],
    });
  }
  register("a2a.askClaude", () => selection("consult"));
  register("a2a.auditCodex", () => selection("review"));
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  status.text = "A2A";
  status.command = "a2a.openSquad";
  status.tooltip = "Open A2A Workspace";
  status.show();
  context.subscriptions.push(status);
  const update = () => {
    const active = store.data.tasks.find((t) =>
      ["running", "needs_input"].includes(t.status),
    );
    status.text = active ? "A2A: " + active.status.replaceAll("_", " ") : "A2A";
  };
  mesh.on("change", update);
  context.subscriptions.push({ dispose: () => mesh.off("change", update) });
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      mesh.workspaceRoot =
        vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
      provider.broadcast();
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidGrantWorkspaceTrust(() => provider.broadcast()),
  );
}
module.exports = { activate, deactivate() {} };
