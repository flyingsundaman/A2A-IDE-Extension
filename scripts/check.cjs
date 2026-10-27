"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
function walk(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walk(file);
    else if (/\.(js|cjs)$/.test(file)) {
      const result = spawnSync(process.execPath, ["--check", file], {
        stdio: "inherit",
      });
      if (result.status !== 0) process.exit(result.status || 1);
    }
  }
}
for (const dir of ["src", "resources", "test", "scripts"]) walk(dir);
console.log("JavaScript syntax checks passed.");
