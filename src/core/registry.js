"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { ClaudeLocalAdapter } = require("../adapters/claudeLocalAdapter");
const { CodexLocalAdapter } = require("../adapters/codexLocalAdapter");
const { AgyPoolAdapter } = require("../adapters/agyPoolAdapter");

class AgentRegistry {
  constructor(config = {}) {
    this.adapters = new Map();
    this.configPath = path.join(os.homedir(), ".gemini", "config", "a2a_agents.json");
    this.initDefaultAdapters(config);
  }

  initDefaultAdapters(config) {
    const claudePath = config.claudeCliPath || "C:\\Users\\acer\\.local\\bin\\claude.exe";
    const codexPath = config.codexCliPath || "C:\\Users\\acer\\AppData\\Local\\OpenAI\\Codex\\bin\\2993767bd1dfb009\\codex.exe";

    const claudeAdapter = new ClaudeLocalAdapter(claudePath);
    const codexAdapter = new CodexLocalAdapter(codexPath);
    const agyAdapter = new AgyPoolAdapter();

    this.adapters.set(claudeAdapter.id, claudeAdapter);
    this.adapters.set(codexAdapter.id, codexAdapter);
    this.adapters.set(agyAdapter.id, agyAdapter);
  }

  getAdapter(id) {
    return this.adapters.get(id);
  }

  getAllAdapters() {
    return Array.from(this.adapters.values());
  }

  async refreshHealth() {
    const results = [];
    for (const adapter of this.adapters.values()) {
      const health = await adapter.checkHealth();
      results.push({
        id: adapter.id,
        name: adapter.name,
        role: adapter.role,
        status: adapter.status,
        health
      });
    }
    return results;
  }
}

module.exports = { AgentRegistry };
