"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
function executable(name) {
  if (!name) return "";
  const dirs = path.isAbsolute(name)
    ? [""]
    : (process.env.PATH || "").split(path.delimiter);
  for (const dir of dirs)
    for (const suffix of process.platform === "win32" && !path.extname(name)
      ? [".exe", ".cmd", ""]
      : [""]) {
      const file = path.resolve(dir, name + suffix);
      try {
        fs.accessSync(file, fs.constants.F_OK);
        return file;
      } catch {}
    }

  if (process.platform === "win32") {
    if (name === "codex") {
      const localAppData = process.env.LOCALAPPDATA;
      if (localAppData) {
        const codexBase = path.join(localAppData, "OpenAI", "Codex", "bin");
        if (fs.existsSync(codexBase)) {
          try {
            const subdirs = fs.readdirSync(codexBase);
            for (const sub of subdirs) {
              const candidate = path.join(codexBase, sub, "codex.exe");
              if (fs.existsSync(candidate)) return candidate;
            }
          } catch {}
        }
      }
    }
    if (name === "claude") {
      const home = process.env.USERPROFILE || "";
      const localClaude = path.join(home, ".local", "bin", "claude.exe");
      if (fs.existsSync(localClaude)) return localClaude;
    }
  }

  return "";
}
function run(file, args, { cwd, signal, timeout = 180000, onData } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Cancelled"));
    const child = spawn(file, args, {
      cwd,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "",
      err = "",
      settled = false,
      killTimer;
    const kill = (signal) => {
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {}
    };
    const stop = () => {
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), 2000);
      killTimer.unref();
    };
    const abort = () => {
      stop();
      finish(new Error("Cancelled"));
    };
    const timer = setTimeout(() => {
      stop();
      finish(new Error("Process timed out"));
    }, timeout);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    }
    signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (e) => finish(e));
    child.stdout.on("data", (b) => {
      out += b;
      onData?.(String(b));
      if (out.length > 2000000) {
        stop();
        finish(new Error("Process output exceeds 2 MB"));
      }
    });
    child.stderr.on("data", (b) => {
      err = (err + b).slice(-16000);
    });
    child.on("close", (code) => {
      finish(null, { code, stdout: out.trim(), stderr: err.trim() });
    });
  });
}
module.exports = { executable, run };
