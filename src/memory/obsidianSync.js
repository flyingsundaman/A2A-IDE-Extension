"use strict";

const fs = require("fs");
const path = require("path");

class ObsidianSync {
  constructor(vaultPath = "") {
    this.vaultPath = vaultPath;
  }

  setVaultPath(newPath) {
    this.vaultPath = newPath;
  }

  isConfigured() {
    return Boolean(this.vaultPath && fs.existsSync(this.vaultPath));
  }

  /**
   * Scan Obsidian Vault for guideline / architecture documents to inject into agents.
   * @param {string} subfolder - Optional subfolder e.g. "Guidelines" or "Architecture"
   * @returns {string} Concatenated context from markdown files.
   */
  readContext(subfolder = "") {
    if (!this.isConfigured()) return "";

    const targetDir = subfolder ? path.join(this.vaultPath, subfolder) : this.vaultPath;
    if (!fs.existsSync(targetDir)) return "";

    let context = "";
    try {
      const files = fs.readdirSync(targetDir);
      for (const file of files) {
        if (file.endsWith(".md") && !file.startsWith(".")) {
          const filePath = path.join(targetDir, file);
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.size < 50000) {
            // Read files under 50KB to preserve context window
            const content = fs.readFileSync(filePath, "utf8");
            context += `\n\n--- [Obsidian Note: [[${file}]]] ---\n${content.slice(0, 4000)}`;
          }
        }
      }
    } catch (err) {
      console.warn("Failed reading Obsidian context:", err.message);
    }
    return context.trim();
  }

  /**
   * Save an Architectural Decision Record (ADR) into Obsidian Vault.
   * @param {Object} data - { taskTitle, context, architectureText, securityText, patchSummary, agents }
   * @returns {{ success: boolean, filePath?: string, error?: string }}
   */
  saveAdr(data) {
    if (!this.isConfigured()) {
      return { success: false, error: "Obsidian Vault path is not set or does not exist." };
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toTimeString().slice(0, 8);
    const slug = (data.taskTitle || "untitled-task")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const adrDir = path.join(this.vaultPath, "ADR");
    if (!fs.existsSync(adrDir)) {
      try {
        fs.mkdirSync(adrDir, { recursive: !0 });
      } catch (err) {
        return { success: false, error: "Cannot create ADR directory: " + err.message };
      }
    }

    const fileName = `${dateStr}-${slug}.md`;
    const targetFile = path.join(adrDir, fileName);

    const frontmatter = `---
title: "ADR: ${data.taskTitle || "Architectural Decision"}"
date: "${dateStr} ${timeStr}"
status: Accepted
tags:
  - a2a-mesh
  - adr
  - architecture
squad_agents:
  - Claude Code (Architect)
  - OpenAI Codex (Security QA)
  - Antigravity IDE (Executor)
---

# ADR: ${data.taskTitle}

## 1. Context & Problem Statement
${data.context || "No context provided."}

## 2. Architectural Blueprint (Claude Code)
${data.architectureText || "Architecture accepted without modifications."}

## 3. Security Audit & Edge Cases (OpenAI Codex)
${data.securityText || "All security verifications passed."}

## 4. Implementation & Patch Summary (Antigravity IDE)
${data.patchSummary || "Applied directly to project codebase."}

---
*Generated autonomously by **Antigravity A2A Mesh** · Synchronized to Obsidian.*
`;

    try {
      fs.writeFileSync(targetFile, frontmatter, "utf8");
      return { success: true, filePath: targetFile, fileName };
    } catch (err) {
      return { success: false, error: "Failed writing ADR note: " + err.message };
    }
  }
}

module.exports = { ObsidianSync };
