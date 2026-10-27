"use strict";
const fs = require("node:fs");
const path = require("node:path");
function inside(root, relative) {
  if (!root || typeof relative !== "string" || path.isAbsolute(relative))
    throw new Error("Select a relative path inside the configured root.");
  const realRoot = fs.realpathSync(root);
  const target = path.resolve(realRoot, relative);
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  for (const candidate of [target, realExisting]) {
    const rel = path.relative(realRoot, candidate);
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel))
      throw new Error("Path escapes the configured root.");
  }
  return target;
}
function listNotes(root, dir = "", depth = 0) {
  if (!root || depth > 8) return [];
  const result = [];
  for (const file of fs.readdirSync(inside(root, dir), {
    withFileTypes: true,
  })) {
    if (file.name.startsWith(".") || file.isSymbolicLink()) continue;
    const relative = path.join(dir, file.name);
    if (file.isDirectory())
      result.push(...listNotes(root, relative, depth + 1));
    else if (file.isFile() && /\.md$/i.test(file.name)) result.push(relative);
    if (result.length >= 500) return result.slice(0, 500);
  }
  return result;
}
function context(data, agent, enabledSkillIds) {
  let text = "";
  const sources = [];
  for (const note of data.knowledge.notes || []) {
    const file = inside(data.knowledge.vaultPath, note);
    if (fs.statSync(file).size > 50000)
      throw new Error(`Note is larger than 50 KB: ${note}`);
    text += `\n\n[Vault: ${note}]\n${fs.readFileSync(file, "utf8")}`;
    sources.push("Vault: " + note);
  }
  const selected = enabledSkillIds || agent.skillIds || [];
  for (const id of selected) {
    if (!(agent.skillIds || []).includes(id))
      throw new Error(
        "Agent does not have permission to use the selected skill.",
      );
    const skill = data.skills.find((s) => s.id === id);
    if (!skill) throw new Error("Selected skill no longer exists.");
    text += `\n\n[Skill: ${skill.name}]\n${skill.instructions}`;
    sources.push("Skill: " + skill.name);
  }
  if (text.length > 100000)
    throw new Error(
      "Selected knowledge exceeds 100,000 characters. Select fewer notes or skills.",
    );
  return { text, sources };
}
function exportTask(knowledge, task) {
  if (!knowledge.vaultPath) throw new Error("Select an Obsidian vault first.");
  const dir = inside(knowledge.vaultPath, "ADR");
  fs.mkdirSync(dir, { recursive: true });
  const file = inside(knowledge.vaultPath, `ADR/${task.id}.md`);
  const text = `# ${task.title}\n\nStatus: ${task.status}\nCreated: ${task.createdAt}\n\n## Request\n${task.prompt}\n\n${task.steps.map((s) => `## ${s.role} — ${s.agentName}\nStatus: ${s.status}\n\n${s.output || s.error || "Not executed."}`).join("\n\n")}\n\n${task.error ? "## Error\n" + task.error : ""}\n`;
  fs.writeFileSync(file, text, { encoding: "utf8", mode: 0o600 });
  return file;
}
module.exports = { inside, listNotes, context, exportTask };
