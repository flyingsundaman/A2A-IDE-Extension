"use strict";
const { spawn } = require("node:child_process");
const { request } = require("./http");
class StdioClient {
  constructor(config, secret, signal) {
    this.next = 0;
    this.pending = new Map();
    this.buffer = "";
    this.closed = false;
    const env = { ...process.env };
    if (secret && config.secretEnv) env[config.secretEnv] = secret;
    this.child = spawn(config.executable, JSON.parse(config.args || "[]"), {
      shell: false,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child.stderr.on("data", () => {});
    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      if (this.buffer.length > 2000000)
        return this.close(new Error("MCP response exceeds 2 MB"));
      let end;
      while ((end = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        try {
          const msg = JSON.parse(line);
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            clearTimeout(p.timer);
            msg.error
              ? p.reject(new Error("MCP server returned a protocol error"))
              : p.resolve(msg.result);
          } else if (msg.method && msg.id !== undefined)
            this.child.stdin.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                error: { code: -32601, message: "Client method not supported" },
              }) + "\n",
            );
        } catch {}
      }
    });
    this.child.on("error", () =>
      this.close(new Error("Unable to launch MCP executable")),
    );
    this.child.on("exit", () => this.close(new Error("MCP server exited")));
    this.child.stdin.on("error", () =>
      this.close(new Error("MCP input closed")),
    );
    this.abort = () => this.close(new Error("Cancelled"));
    this.signal = signal;
    signal?.addEventListener("abort", this.abort, { once: true });
    if (signal?.aborted) this.abort();
  }
  rpc(method, params) {
    if (this.closed) return Promise.reject(new Error("MCP connection closed"));
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("MCP request timed out"));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }
  async init() {
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "a2a-mesh", version: "2.0.0" },
    });
    this.child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
  }
  close(error = new Error("MCP connection closed")) {
    if (this.closed) return;
    this.closed = true;
    this.signal?.removeEventListener("abort", this.abort);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
    this.child.kill();
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 2000);
    timer.unref();
  }
}
class HttpClient {
  constructor(config, secret, signal) {
    this.config = config;
    this.secret = secret;
    this.signal = signal;
    this.id = 0;
  }
  async rpc(method, params) {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2024-11-05",
    };
    if (this.secret) headers.Authorization = `Bearer ${this.secret}`;
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    const response = await request(
      this.config.endpoint,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
      },
      this.signal,
      (text) => {
        if (!text.includes("data:")) return false;
        return text
          .split(/\r?\n\r?\n/)
          .slice(0, -1)
          .some((event) => {
            try {
              const data = event
                .split(/\r?\n/)
                .filter((l) => l.startsWith("data:"))
                .map((l) => l.slice(5).trim())
                .join("\n");
              return JSON.parse(data).id === this.id;
            } catch {
              return false;
            }
          });
      },
    );
    this.session = response.headers.get("mcp-session-id") || this.session;
    let msg;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      for (const event of response.text.split(/\r?\n\r?\n/)) {
        const data = event
          .split(/\r?\n/)
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
          .join("\n");
        if (data) {
          const candidate = JSON.parse(data);
          if (candidate.id === this.id) msg = candidate;
        }
      }
    } else msg = JSON.parse(response.text);
    if (!msg || msg.error)
      throw new Error("MCP server returned an error or no response");
    return msg.result;
  }
  async init() {
    const result = await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "a2a-mesh", version: "2.0.0" },
    });
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": result.protocolVersion || "2024-11-05",
    };
    if (this.secret) headers.Authorization = `Bearer ${this.secret}`;
    if (this.session) headers["Mcp-Session-Id"] = this.session;
    await request(
      this.config.endpoint,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      },
      this.signal,
    );
  }
  close() {}
}
async function connect(config, secret, signal) {
  const client =
    config.transport === "stdio"
      ? new StdioClient(config, secret, signal)
      : new HttpClient(config, secret, signal);
  try {
    await client.init();
    return client;
  } catch (e) {
    client.close();
    throw e;
  }
}
async function discover(client) {
  const tools = [];
  let cursor;
  do {
    const page = await client.rpc("tools/list", cursor ? { cursor } : {});
    tools.push(...(page.tools || []));
    cursor = page.nextCursor;
    if (tools.length > 100)
      throw new Error("Connector exposes too many tools (maximum 100)");
  } while (cursor);
  return tools;
}
module.exports = { connect, discover };
