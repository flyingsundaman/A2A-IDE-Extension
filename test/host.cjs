"use strict";
const assert = require("node:assert/strict");
exports.run = async () => {
  const vscode = require("vscode");
  const ext = vscode.extensions.getExtension("local-mesh.antigravity-a2a-mesh");
  assert.ok(ext, "Extension discovered");
  await ext.activate();
  assert.equal(ext.isActive, true);
  for (const command of [
    "a2a.openAgents",
    "a2a.openSquad",
    "a2a.runCouncil",
    "a2a.syncObsidian",
  ])
    await vscode.commands.executeCommand(command);
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("a2a.openAgents"));
  await vscode.commands.executeCommand("workbench.view.extension.a2a-sidebar");
  assert.equal(ext.packageJSON.version, "2.0.0");
  console.log(
    "PASS actual VS Code extension activation, registered commands, editor panel and contributed panel",
  );
};
