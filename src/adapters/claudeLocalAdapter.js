"use strict";

const { spawn, execFile } = require("child_process");
const fs = require("fs");
const { BaseAdapter } = require("./baseAdapter");

class ClaudeLocalAdapter extends BaseAdapter {
  constructor(cliPath = "C:\\Users\\acer\\.local\\bin\\claude.exe") {
    super("claude-code", "Claude Code", "System Architect");
    this.cliPath = cliPath;
  }

  async checkHealth() {
    if (!fs.existsSync(this.cliPath)) {
      this.status = "OFFLINE";
      return { available: false, status: "Binary not found at " + this.cliPath };
    }

    return new Promise((resolve) => {
      execFile(this.cliPath, ["auth", "status"], { timeout: 6000 }, (err, stdout) => {
        if (err) {
          this.status = "OFFLINE";
          return resolve({ available: false, status: "Auth check failed: " + err.message });
        }
        try {
          const authData = JSON.parse(stdout);
          if (authData.loggedIn) {
            this.status = "IDLE";
            return resolve({
              available: true,
              status: `Logged in (${authData.subscriptionType || "Pro"})`,
              details: authData
            });
          } else {
            this.status = "OFFLINE";
            return resolve({ available: false, status: "Not logged in" });
          }
        } catch {
          this.status = "IDLE";
          resolve({ available: true, status: "Ready", raw: stdout });
        }
      });
    });
  }

  async execute(context) {
    this.status = "RUNNING";
    this.lastActive = Date.now();

    const promptText = context.code
      ? `${context.prompt}\n\n[Reference Code / Context]:\n\`\`\`\n${context.code}\n\`\`\``
      : context.prompt;

    const args = ["-p", promptText, "--output-format", "text"];
    const cwd = context.workspaceRoot || process.cwd();

    return new Promise((resolve) => {
      // stdio: ['ignore', 'pipe', 'pipe'] prevents stdin wait warning
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

        if (code === 0) {
          resolve({
            success: true,
            text: stdout.trim(),
            metadata: { exitCode: code, runtime: "claude-local" }
          });
        } else {
          // If hit session limit or error
          const combined = (stdout + "\n" + stderr).trim();
          resolve({
            success: false,
            text: combined,
            error: combined || `Process exited with code ${code}`,
            metadata: { exitCode: code }
          });
        }
      });

      proc.on("error", (err) => {
        this.status = "ERROR";
        resolve({
          success: false,
          text: "",
          error: `Failed to spawn Claude process: ${err.message}`
        });
      });
    });
  }
}

module.exports = { ClaudeLocalAdapter };
