#!/usr/bin/env node
"use strict";

const readline = require("readline");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { Orchestrator } = require("../core/orchestrator");

// Load config from ~/.gemini/config/a2a_config.json if available
let userConfig = {};
const globalConfigPath = path.join(os.homedir(), ".gemini", "config", "a2a_config.json");
if (fs.existsSync(globalConfigPath)) {
  try {
    userConfig = JSON.parse(fs.readFileSync(globalConfigPath, "utf8"));
  } catch {}
}

const orchestrator = new Orchestrator(userConfig);

// Basic JSON-RPC 2.0 / MCP stdio protocol implementation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

const tools = [
  {
    name: "a2a_consult_agent",
    description: "Consult a specific peer agent in the A2A Mesh (claude-code, openai-codex, or agy-pool).",
    inputSchema: {
      type: "object",
      properties: {
        agent: {
          type: "string",
          enum: ["claude-code", "openai-codex", "agy-pool"],
          description: "Target agent identifier"
        },
        prompt: { type: "string", description: "Instructions or question for the agent" },
        code: { type: "string", description: "Optional code snippet or context" }
      },
      required: ["agent", "prompt"]
    }
  },
  {
    name: "a2a_run_council",
    description: "Trigger a full A2A Council debate across Claude Code (Architect) and OpenAI Codex (Security QA).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Title of the task/feature" },
        prompt: { type: "string", description: "Task requirement and context" },
        code: { type: "string", description: "Optional code snippet to audit and discuss" }
      },
      required: ["title", "prompt"]
    }
  },
  {
    name: "a2a_sync_obsidian_adr",
    description: "Document and sync an Architectural Decision Record (ADR) into the connected Obsidian Vault.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "ADR Title" },
        context: { type: "string", description: "Problem statement" },
        architecture: { type: "string", description: "Architecture specification" },
        security: { type: "string", description: "Security audit findings" },
        patch: { type: "string", description: "Implementation summary" }
      },
      required: ["title", "context"]
    }
  },
  {
    name: "a2a_list_agents",
    description: "List all active agents in the A2A Mesh and their real-time health/quota status.",
    inputSchema: { type: "object", properties: {} }
  }
];

function sendResponse(id, result) {
  const payload = { jsonrpc: "2.0", id, result };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function sendError(id, code, message) {
  const payload = { jsonrpc: "2.0", id, error: { code, message } };
  process.stdout.write(JSON.stringify(payload) + "\n");
}

rl.on("line", async (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    const { id, method, params } = req;

    if (method === "initialize") {
      return sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "antigravity-a2a-mesh", version: "1.0.0" }
      });
    }

    if (method === "tools/list") {
      return sendResponse(id, { tools });
    }

    if (method === "tools/call") {
      const toolName = params.name;
      const args = params.arguments || {};

      if (toolName === "a2a_consult_agent") {
        const result = await orchestrator.consultAgent(args.agent, args.prompt, args.code || "");
        return sendResponse(id, {
          content: [{ type: "text", text: result.text || JSON.stringify(result) }]
        });
      }

      if (toolName === "a2a_run_council") {
        const result = await orchestrator.runCouncilPipeline(args.title, args.prompt, args.code || "");
        return sendResponse(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        });
      }

      if (toolName === "a2a_sync_obsidian_adr") {
        const result = orchestrator.obsidian.saveAdr({
          taskTitle: args.title,
          context: args.context,
          architectureText: args.architecture,
          securityText: args.security,
          patchSummary: args.patch
        });
        return sendResponse(id, {
          content: [{ type: "text", text: JSON.stringify(result) }]
        });
      }

      if (toolName === "a2a_list_agents") {
        const agents = await orchestrator.registry.refreshHealth();
        return sendResponse(id, {
          content: [{ type: "text", text: JSON.stringify(agents, null, 2) }]
        });
      }

      return sendError(id, -32601, `Unknown tool: ${toolName}`);
    }

    if (method === "notifications/initialized") {
      // Client ack
      return;
    }

    // Default response for unhandled ping or methods
    sendResponse(id, {});
  } catch (err) {
    // Malformed JSON or uncaught error
  }
});
