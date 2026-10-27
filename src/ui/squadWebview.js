"use strict";
const vscode = require("vscode");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { endpoint } = require("../runtime/http");
const { defaults } = require("../runtime/providers");
const { executable } = require("../runtime/process");
const { listNotes, exportTask } = require("../runtime/knowledge");
const text = (v, max = 200) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
const ids = (v) =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 100) : [];
class SquadWebviewProvider {
  constructor(context, mesh) {
    this.context = context;
    this.mesh = mesh;
    this.views = new Set();
    this.listener = () => this.broadcast();
    mesh.on("change", this.listener);
  }
  dispose() {
    this.mesh.off("change", this.listener);
    this.views.clear();
  }
  resolveWebviewView(view) {
    this.attach(view.webview);
    view.onDidDispose(() => this.views.delete(view.webview));
  }
  open(page = "chat") {
    if (this.panel) {
      this.panel.reveal();
      this.panel.webview.postMessage({ type: "navigate", page });
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "a2a.workspace",
      "A2A Workspace",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.attach(this.panel.webview, page);
    this.panel.onDidDispose(() => {
      this.views.delete(this.panel.webview);
      this.panel = null;
    });
  }
  async snapshot() {
    const state = this.mesh.snapshot();
    const connections = await Promise.all(
      state.connections.map(async (c) => ({
        ...c,
        hasSecret: !!(await this.context.secrets.get("connection:" + c.id)),
      })),
    );
    const connectors = await Promise.all(
      state.connectors.map(async (c) => ({
        ...c,
        hasSecret: !!(await this.context.secrets.get("connector:" + c.id)),
      })),
    );
    let notes = [],
      knowledgeError = "";
    try {
      notes = listNotes(state.knowledge.vaultPath);
    } catch (e) {
      knowledgeError = e.message;
    }
    return {
      ...state,
      connections,
      connectors,
      availableNotes: notes,
      knowledgeError,
    };
  }
  async broadcast() {
    const state = await this.snapshot();
    for (const view of this.views) view.postMessage({ type: "state", state });
  }
  attach(webview, page = "agents") {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "resources"),
      ],
    };
    this.views.add(webview);
    webview.html = this.html(webview, page);
    this.context.subscriptions.push(
      webview.onDidReceiveMessage(async (data) => {
        try {
          await this.handle(data);
          await this.broadcast();
          webview.postMessage({ type: "done", command: data.command });
        } catch (e) {
          webview.postMessage({ type: "error", message: e.message });
        }
      }),
    );
  }
  async handle(data) {
    if (!data || typeof data.command !== "string")
      throw new Error("Invalid request");
    const { command, id } = data;
    const store = this.mesh.store;
    if (command === "ready") return;
    if (command === "openFull") return this.open(data.page);
    if (command === "saveConnection") {
      this.mesh.guard();
      const v = data.value || {};
      const provider = text(v.provider);
      const mode = text(v.mode);
      if (
        ![
          "codex",
          "claude",
          "custom",
          "openai",
          "anthropic",
          "gemini",
          "compatible",
        ].includes(provider)
      )
        throw new Error("Unsupported provider");
      if (
        !["api", "cli"].includes(mode) ||
        ["codex", "claude", "custom"].includes(provider) !== (mode === "cli")
      )
        throw new Error("Provider does not support that connection method");
      if (!text(v.name)) throw new Error("Connection name is required");
      const args = text(v.args, 5000) || '["{prompt}"]';
      if (mode === "cli" && provider === "custom") {
        const parsed = JSON.parse(args);
        if (
          !Array.isArray(parsed) ||
          !parsed.every((a) => typeof a === "string") ||
          !parsed.some((a) => a.includes("{prompt}"))
        )
          throw new Error(
            "CLI arguments must be a JSON array containing {prompt}",
          );
      }
      if (v.id) store.get("connections", v.id);
      const connection = store.upsert("connections", {
        id: text(v.id) || undefined,
        name: text(v.name),
        mode,
        provider,
        endpoint:
          mode === "api"
            ? endpoint(text(v.endpoint, 2000) || defaults[provider])
            : "",
        executable: mode === "cli" ? text(v.executable, 2000) || provider : "",
        args,
      });
      delete this.mesh.health[connection.id];
      return;
    }
    if (command === "setSecret") {
      this.mesh.guard();
      if (!["connection", "connector"].includes(data.kind))
        throw new Error("Invalid secret type");
      store.get(data.kind === "connection" ? "connections" : "connectors", id);
      const key = await vscode.window.showInputBox({
        title: "Set " + data.kind + " credential",
        prompt:
          "Stored in IDE SecretStorage. Leave empty to keep the current value.",
        password: true,
        ignoreFocusOut: true,
      });
      if (key)
        await this.context.secrets.store(data.kind + ":" + id, key.trim());
      return;
    }
    if (command === "clearSecret") {
      if (!["connection", "connector"].includes(data.kind))
        throw new Error("Invalid secret type");
      if (
        (await vscode.window.showWarningMessage(
          "Remove the saved credential?",
          { modal: true },
          "Remove",
        )) === "Remove"
      )
        await this.context.secrets.delete(data.kind + ":" + id);
      return;
    }
    if (command === "detect") {
      this.mesh.guard();
      const found = ["codex", "claude"]
        .map((provider) => ({
          label: provider,
          provider,
          file: executable(provider),
        }))
        .filter((x) => x.file);
      if (!found.length)
        throw new Error(
          "No Codex or Claude CLI was found in PATH. Install its official CLI on this machine or enter an executable path.",
        );
      const chosen = await vscode.window.showQuickPick(found, {
        title: "Use a local CLI session",
      });
      if (!chosen) return;
      const existing = store.data.connections.find(
        (c) => c.mode === "cli" && c.executable === chosen.file,
      );
      const c =
        existing ||
        store.upsert("connections", {
          name: chosen.label + " local",
          mode: "cli",
          provider: chosen.provider,
          executable: chosen.file,
          args: "",
        });
      if (!store.data.agents.some((a) => a.connectionId === c.id))
        store.upsert("agents", {
          name: chosen.label + " Assistant",
          connectionId: c.id,
          model: "",
          role: "Assistant",
          instructions: "",
          allowEdits: false,
          skillIds: [],
          connectorIds: [],
        });
      await this.mesh.testConnection(c.id);
      return;
    }
    if (command === "login") {
      this.mesh.guard();
      const c = store.get("connections", id);
      if (c.mode !== "cli" || !["codex", "claude"].includes(c.provider))
        throw new Error(
          "Direct login is supported through the official Codex and Claude CLIs. Configure other providers through their supported authentication flow.",
        );
      const file = executable(c.executable || c.provider);
      if (!file)
        throw new Error(
          "CLI not found. Install the official CLI or fix the executable path first.",
        );
      vscode.window
        .createTerminal({
          name: "A2A Login: " + c.name,
          shellPath: file,
          shellArgs:
            c.provider === "codex"
              ? ["login", "--device-auth"]
              : ["auth", "login"],
        })
        .show();
      return;
    }
    if (command === "testConnection") return this.mesh.testConnection(id);
    if (command === "saveAgent") {
      const v = data.value || {};
      const c = store.get("connections", v.connectionId);
      if (v.id) store.get("agents", v.id);
      if (!text(v.name) || !text(v.role))
        throw new Error("Agent name and role are required");
      if (c.mode === "api" && !text(v.model))
        throw new Error("Choose a model or enter its model ID");
      const skillIds = ids(v.skillIds),
        connectorIds = ids(v.connectorIds);
      for (const s of skillIds) store.get("skills", s);
      for (const c of connectorIds) store.get("connectors", c);
      if (c.mode === "cli" && connectorIds.length)
        throw new Error(
          "Managed connectors require an API agent. CLI tools keep their own native configuration.",
        );
      store.upsert("agents", {
        id: text(v.id) || undefined,
        name: text(v.name),
        role: text(v.role),
        connectionId: c.id,
        model: text(v.model),
        instructions: text(v.instructions, 16000),
        allowEdits: !!v.allowEdits,
        skillIds,
        connectorIds,
      });
      return;
    }
    if (command === "saveConnector") {
      this.mesh.guard();
      const v = data.value || {};
      if (!["stdio", "http", "service"].includes(v.transport) || !text(v.name))
        throw new Error("Connector name and transport are required");
      if (v.id) store.get("connectors", v.id);
      const args = text(v.args, 5000) || "[]";
      if (v.transport === "stdio") {
        const a = JSON.parse(args);
        if (
          !text(v.executable, 2000) ||
          !Array.isArray(a) ||
          !a.every((x) => typeof x === "string")
        )
          throw new Error("Enter an executable and a JSON array of arguments");
      }
      const secretEnv = text(v.secretEnv);
      if (secretEnv && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(secretEnv))
        throw new Error("Invalid credential environment variable name");
      if (
        secretEnv &&
        /^(PATH|HOME|NODE_OPTIONS|LD_.*|DYLD_.*)$/i.test(secretEnv)
      )
        throw new Error("Choose a service-specific credential variable");
      store.upsert("connectors", {
        id: text(v.id) || undefined,
        name: text(v.name),
        transport: v.transport,
        executable: v.transport === "stdio" ? text(v.executable, 2000) : "",
        args,
        endpoint:
          v.transport !== "stdio" ? endpoint(text(v.endpoint, 2000)) : "",
        secretEnv,
      });
      return;
    }
    if (command === "testConnector") {
      const result = await this.mesh.testConnector(id);
      await vscode.window.showInformationMessage(
        result.detail +
          (result.tools?.length ? ": " + result.tools.join(", ") : ""),
      );
      return;
    }
    if (command === "pickVault") {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Use vault",
      });
      if (picked?.[0]) {
        const vaultPath = fs.realpathSync(picked[0].fsPath);
        store.data.knowledge = {
          ...store.data.knowledge,
          vaultPath,
          notes: [],
        };
        store.save();
      }
      return;
    }
    if (command === "saveKnowledge") {
      const notes = ids(data.notes);
      const available = listNotes(store.data.knowledge.vaultPath);
      if (notes.some((n) => !available.includes(n)))
        throw new Error("A selected note is not available in the vault");
      store.data.knowledge.notes = notes;
      store.data.knowledge.autoExport = !!data.autoExport;
      store.save();
      return;
    }
    if (command === "disconnectVault") {
      store.data.knowledge = { vaultPath: "", notes: [], autoExport: false };
      store.save();
      return;
    }
    if (command === "importSkill") {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: { Markdown: ["md"] },
        openLabel: "Import skill",
      });
      if (picked?.[0]) {
        const file = picked[0].fsPath;
        if (fs.statSync(file).size > 30000)
          throw new Error("Skill file exceeds 30 KB");
        store.upsert("skills", {
          name: path.basename(path.dirname(file)) + " / " + path.basename(file),
          instructions: fs.readFileSync(file, "utf8"),
        });
      }
      return;
    }
    if (command === "saveSkill") {
      const v = data.value || {};
      if (v.id) store.get("skills", v.id);
      if (!text(v.name) || !text(v.instructions, 30000))
        throw new Error("Skill name and instructions are required");
      store.upsert("skills", {
        id: text(v.id) || undefined,
        name: text(v.name),
        instructions: text(v.instructions, 30000),
      });
      return;
    }
    if (command === "remove") {
      const collection = data.collection;
      if (
        !["connections", "agents", "connectors", "skills"].includes(collection)
      )
        throw new Error("Invalid collection");
      const item = store.get(collection, id);
      if (this.mesh.active.size)
        throw new Error(
          "Wait for the active task before removing configuration",
        );
      if (
        collection === "connections" &&
        store.data.agents.some((a) => a.connectionId === id)
      )
        throw new Error(
          "Remove or reassign agents using this connection first",
        );
      if (
        (await vscode.window.showWarningMessage(
          "Remove " + item.name + "?",
          { modal: true },
          "Remove",
        )) !== "Remove"
      )
        return;
      store.data[collection] = store.data[collection].filter(
        (x) => x.id !== id,
      );
      if (collection === "skills" || collection === "connectors")
        for (const a of store.data.agents) {
          const field = collection === "skills" ? "skillIds" : "connectorIds";
          a[field] = (a[field] || []).filter((x) => x !== id);
        }
      if (collection === "connections" || collection === "connectors")
        await this.context.secrets.delete(
          (collection === "connections" ? "connection:" : "connector:") + id,
        );
      store.save();
      return;
    }
    if (command === "send" || command === "runTask") {
      const history =
        command === "send"
          ? store.data.messages
              .filter(
                (m) =>
                  m.agentId === data.agentId &&
                  m.workspaceRoot === this.mesh.workspaceRoot,
              )
              .slice(-20)
              .map((m) => ({ role: m.role, content: m.text }))
          : [];
      return this.mesh.execute({
        kind: command === "send" ? "chat" : "task",
        title: text(data.title),
        prompt: text(data.prompt, 50001),
        agentIds: command === "send" ? [data.agentId] : ids(data.agentIds),
        history,
      });
    }
    if (command === "cancel") return this.mesh.cancel(id);
    if (command === "retry") return this.mesh.retry(id);
    if (command === "accept") return this.mesh.accept(id);
    if (command === "revise") {
      const task = store.get("tasks", id);
      if (task.workspaceRoot !== this.mesh.workspaceRoot)
        throw new Error("Open the original task workspace before revising.");
      return this.mesh.execute({
        title: task.title + " (revision)",
        prompt:
          task.prompt +
          "\n\nPrevious results:\n" +
          task.steps.map((s) => s.output || s.error || "").join("\n\n") +
          "\n\nRevision instructions:\n" +
          text(data.prompt, 10000),
        agentIds: task.agentIds,
      });
    }
    if (command === "exportTask") {
      const task = store.get("tasks", id);
      task.exportedTo = exportTask(store.data.knowledge, task);
      store.save();
      return;
    }
    if (command === "clearChat") {
      if (this.mesh.active.size)
        throw new Error("Wait for the current response");
      if (
        (await vscode.window.showWarningMessage(
          "Clear chat history? Task records will remain.",
          { modal: true },
          "Clear",
        )) === "Clear"
      ) {
        store.data.messages = [];
        store.save();
      }
      return;
    }
    throw new Error("Unknown action");
  }
  html(webview, page) {
    const nonce = randomBytes(18).toString("base64");
    const resource = (name) =>
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "resources", name),
      );
    const template = fs.readFileSync(
      path.join(this.context.extensionPath, "resources", "workspace.html"),
      "utf8",
    );
    return template
      .replaceAll("{{CSP}}", webview.cspSource)
      .replaceAll("{{NONCE}}", nonce)
      .replace("{{CSS}}", resource("workspace.css"))
      .replace("{{JS}}", resource("workspace.js"))
      .replace(
        "{{PAGE}}",
        ["agents", "knowledge", "chat", "tasks"].includes(page)
          ? page
          : "agents",
      );
  }
}
module.exports = { SquadWebviewProvider };
