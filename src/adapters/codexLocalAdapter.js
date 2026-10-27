"use strict";

const { spawn, execFile } = require("child_process");
const fs = require("fs");
const { BaseAdapter } = require("./baseAdapter");

class CodexLocalAdapter extends BaseAdapter {
  constructor(cliPath = "C:\\Users\\acer\\AppData\\Local\\OpenAI\\Codex\\bin\\2993767bd1dfb009\\codex.exe") {
    super("openai-codex", "OpenAI Codex", "Adversarial Reviewer & QA");
    this.cliPath = cliPath;
  }

  async checkHealth() {
    if (!fs.existsSync(this.cliPath)) {
      this.status = "OFFLINE";
      return { available: false, status: "Binary not found at " + this.cliPath };
    }

    return new Promise((resolve) => {
      execFile(this.cliPath, ["login", "status"], { timeout: 5000 }, (err, stdout) => {
        const out = (stdout || "").trim();
        if (out.toLowerCase().includes("not logged in") || err) {
          this.status = "STANDBY";
          return resolve({
            available: true,
            status: "Ready (Login Required via 'codex login')",
            needsLogin: true
          });
        }
        this.status = "IDLE";
        resolve({
          available: true,
          status: "Logged In",
          details: out
        });
      });
    });
  }

  async execute(context) {
    this.status = "RUNNING";
    this.lastActive = Date.now();

    const cwd = context.workspaceRoot || process.cwd();
    const promptText = context.code
      ? `Audit this code for security vulnerabilities, logic flaws, and edge cases:\n\n\`\`\`\n${context.code}\n\`\`\`\n\nSpecific Focus: ${context.prompt || "General Security & Correctness"}`
      : (context.prompt || "Review active git changes for potential vulnerabilities.");

    // Choose subcommand: review if reviewing uncommitted or diff, otherwise exec
    const args = context.useGitReview
      ? ["review", "--uncommitted", promptText]
      : ["exec", promptText];

    return new Promise((resolve) => {
      const proc = spawn(this.cliPath, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
        windowsHide: true
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString("utf8");
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString("utf8");
      });

      proc.on("close", (code) => {
        this.status = "IDLE";
        this.lastActive = Date.now();

        const combined = (stdout + "\n" + stderr).trim();
        if (code === 0 || stdout.length > 0) {
          resolve({
            success: true,
            text: stdout.trim() || combined,
            metadata: { exitCode: code, runtime: "codex-local" }
          });
        } else {
          resolve({
            success: false,
            text: combined,
            error: combined || `Codex exited with code ${code}`,
            metadata: { exitCode: code }
          });
        }
      });

      proc.on("error", (err) => {
        this.status = "ERROR";
        resolve({
          success: false,
          text: "",
          error: `Failed to spawn Codex process: ${err.message}`
        });
      });
    });
  }
}

module.exports = { CodexLocalAdapter };
