#!/usr/bin/env node
"use strict";
const readline = require("node:readline");
const path = require("node:path");
const os = require("node:os");
const { Store } = require("../runtime/store");
const { Mesh } = require("../runtime/mesh");
const { exportTask } = require("../runtime/knowledge");
const index = process.argv.indexOf("--data-dir");
const dir =
  index >= 0
    ? process.argv[index + 1]
    : path.join(os.homedir(), ".local", "share", "a2a-mesh");
if (!dir) throw new Error("--data-dir requires a directory");
const store = new Store(dir);
const mesh = new Mesh(store, {
  trusted: () => true,
  workspaceRoot: process.cwd(),
  getSecret: async (key) =>
    process.env["A2A_" + key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()] || "",
});
const tools = [
  {
    name: "a2a_consult_agent",
    description:
      "Consult a configured agent. Mutating tools require IDE approval and are denied in standalone mode.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        prompt: { type: "string" },
        code: { type: "string" },
      },
      required: ["agent", "prompt"],
    },
  },
  {
    name: "a2a_run_council",
    description:
      "Run configured agents sequentially. Returns actual stage results, never an automatic audit verdict.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        prompt: { type: "string" },
        agents: { type: "array", items: { type: "string" } },
      },
      required: ["prompt", "agents"],
    },
  },
  {
    name: "a2a_sync_obsidian_adr",
    description:
      "Export an existing task and its actual status to the configured vault.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
    },
  },
  {
    name: "a2a_list_agents",
    description: "List configured agents without credentials.",
    inputSchema: { type: "object", properties: {} },
  },
];
const reply = (id, result, error) =>
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      ...(error ? { error } : { result }),
    }) + "\n",
  );
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    reply(null, null, { code: -32700, message: "Invalid JSON" });
    return;
  }
  if (req.id === undefined) return;
  try {
    if (req.method === "initialize")
      return reply(req.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "antigravity-a2a-mesh", version: "2.0.0" },
      });
    if (req.method === "ping") return reply(req.id, {});
    if (req.method === "tools/list") return reply(req.id, { tools });
    if (req.method !== "tools/call")
      return reply(req.id, null, { code: -32601, message: "Unknown method" });
    const { name, arguments: args = {} } = req.params || {};
    let value;
    if (name === "a2a_list_agents")
      value = store.data.agents.map(
        ({ id, name, role, model, connectionId }) => ({
          id,
          name,
          role,
          model,
          connectionId,
        }),
      );
    else if (name === "a2a_consult_agent")
      value = await mesh.execute({
        kind: "chat",
        prompt: args.prompt + (args.code ? "\n\n" + args.code : ""),
        agentIds: [args.agent],
      });
    else if (name === "a2a_run_council")
      value = await mesh.execute({
        title: args.title,
        prompt: args.prompt,
        agentIds: args.agents,
      });
    else if (name === "a2a_sync_obsidian_adr")
      value = {
        file: exportTask(store.data.knowledge, store.get("tasks", args.taskId)),
      };
    else return reply(req.id, null, { code: -32601, message: "Unknown tool" });
    reply(req.id, {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
      ...(value?.status === "failed" ? { isError: true } : {}),
    });
  } catch (e) {
    reply(req.id, {
      isError: true,
      content: [{ type: "text", text: e.message }],
    });
  }
});
rl.on("close", () => mesh.dispose());
process.on("SIGTERM", () => {
  mesh.dispose();
  rl.close();
});
