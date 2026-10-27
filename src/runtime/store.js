"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const initial = () => ({
  version: 2,
  connections: [],
  agents: [],
  connectors: [],
  skills: [],
  knowledge: { vaultPath: "", notes: [], autoExport: false },
  messages: [],
  tasks: [],
});
class Store {
  constructor(dir) {
    this.file = path.join(dir, "mesh.json");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.data = fs.existsSync(this.file)
      ? JSON.parse(fs.readFileSync(this.file, "utf8"))
      : initial();
    if (this.data.version !== 2)
      throw new Error(
        "Unsupported saved data version; existing data was left untouched.",
      );
    for (const task of this.data.tasks)
      if (["queued", "running", "needs_input"].includes(task.status)) {
        task.status = "interrupted";
        task.error =
          "The extension stopped during execution. Retry explicitly to continue.";
        for (const step of task.steps)
          if (step.status === "running") step.status = "interrupted";
      }
    this.save();
  }
  save() {
    const temp = this.file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  upsert(collection, value) {
    const item = { ...value, id: value.id || randomUUID() };
    const i = this.data[collection].findIndex((x) => x.id === item.id);
    if (i < 0) this.data[collection].push(item);
    else this.data[collection][i] = item;
    this.save();
    return item;
  }
  get(collection, id) {
    const item = this.data[collection].find((x) => x.id === id);
    if (!item) throw new Error(`${collection}: item not found`);
    return item;
  }
}
module.exports = { Store };
