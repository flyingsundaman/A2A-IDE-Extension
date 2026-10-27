"use strict";

const vscode = require("vscode");

class A2AStatusBar {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "a2a.openSquad";
    this.init();
  }

  init() {
    this.update("$(organization) A2A Mesh: Ready");
    this.statusBarItem.show();

    // Listen to orchestrator events
    this.orchestrator.on("taskStageChange", ({ stage, message }) => {
      this.update(`$(sync~spin) A2A: [${stage}] ${message}`);
    });

    this.orchestrator.on("agentStatusChange", ({ agentId, status }) => {
      if (status === "RUNNING") {
        this.update(`$(loading~spin) A2A: ${agentId} working...`);
      } else {
        this.update("$(organization) A2A Mesh: Squad Active");
      }
    });
  }

  update(text, tooltip = "Click to open A2A Agent Squad (Group Chat)") {
    this.statusBarItem.text = text;
    this.statusBarItem.tooltip = tooltip;
  }

  dispose() {
    this.statusBarItem.dispose();
  }
}

module.exports = { A2AStatusBar };
