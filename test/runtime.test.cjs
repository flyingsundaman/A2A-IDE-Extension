"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { Store } = require("../src/runtime/store");
const { Mesh } = require("../src/runtime/mesh");
const { inside, context, exportTask } = require("../src/runtime/knowledge");
const { health } = require("../src/runtime/providers");
const { connect, discover } = require("../src/runtime/connectors");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const workspace = path.join(dir, "workspace");
  fs.mkdirSync(workspace);
  const store = new Store(path.join(dir, "data"));
  return { dir, workspace, store };
}
async function server(t, fn) {
  const s = http.createServer(async (req, res) => {
    let raw = "";
    for await (const b of req) raw += b;
    try {
      const result = await fn(req, raw ? JSON.parse(raw) : {});
      res.writeHead(result.status || 200, {
        "content-type": "application/json",
      });
      res.end(JSON.stringify(result.body));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  t.after(() => {
    s.closeAllConnections();
    s.close();
  });
  return "http://127.0.0.1:" + s.address().port;
}
function agent(store, endpoint, provider = "compatible", extra = {}) {
  const c = store.upsert("connections", {
    name: "Test",
    provider,
    mode: "api",
    endpoint,
  });
  return store.upsert("agents", {
    name: "Test agent",
    role: "Implementer",
    model: "test-model",
    connectionId: c.id,
    instructions: "Be precise",
    allowEdits: false,
    skillIds: [],
    connectorIds: [],
    ...extra,
  });
}
function answer(text) {
  return {
    body: { choices: [{ message: { role: "assistant", content: text } }] },
  };
}
test("API workflow passes previous outputs, persists and requires human review", async (t) => {
  const { store, workspace } = fixture(t);
  let calls = [];
  const url = await server(t, (req, body) => {
    calls.push(body);
    return answer(
      calls.length === 1
        ? "Implementation output"
        : "Review: two issues remain",
    );
  });
  const a = agent(store, url),
    b = store.upsert("agents", {
      ...a,
      id: undefined,
      name: "Reviewer",
      role: "Reviewer",
    });
  const mesh = new Mesh(store, {
    workspaceRoot: workspace,
    trusted: () => true,
  });
  const task = await mesh.execute({
    prompt: "Implement login",
    agentIds: [a.id, b.id],
  });
  assert.equal(task.status, "needs_review");
  assert.equal(task.steps.length, 2);
  assert.match(calls[1].messages.at(-1).content, /Implementation output/);
  assert.match(task.steps[1].output, /two issues/);
  const restored = new Store(path.dirname(store.file));
  assert.equal(restored.data.tasks[0].status, "needs_review");
  mesh.accept(task.id);
  assert.equal(task.status, "completed");
});
test("provider errors fail the stage, skip downstream stages and never report consensus", async (t) => {
  const { store } = fixture(t);
  let requests = 0;
  const url = await server(t, () => {
    requests++;
    return { status: 401, body: { error: "SECRET-DO-NOT-PRINT" } };
  });
  const a = agent(store, url);
  const mesh = new Mesh(store, { trusted: () => true });
  const task = await mesh.execute({ prompt: "Work", agentIds: [a.id, a.id] });
  assert.equal(task.status, "failed");
  assert.equal(requests, 1);
  assert.equal(task.steps[1].status, "skipped");
  assert.doesNotMatch(task.error, /SECRET/);
  assert.throws(() => mesh.accept(task.id));
});
test("workspace API tool execution requests approval and writes only approved files", async (t) => {
  const { store, workspace } = fixture(t);
  let calls = 0;
  let approved = 0;
  const url = await server(t, (req, body) => {
    calls++;
    if (calls === 1)
      return {
        body: {
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "write1",
                    type: "function",
                    function: {
                      name: "workspace_write",
                      arguments: JSON.stringify({
                        path: "hello.txt",
                        content: "Hello world",
                      }),
                    },
                  },
                ],
              },
            },
          ],
        },
      };
    assert.equal(body.messages.at(-1).role, "tool");
    return answer("Created hello.txt");
  });
  const a = agent(store, url, "compatible", { allowEdits: true });
  const mesh = new Mesh(store, {
    workspaceRoot: workspace,
    trusted: () => true,
    confirm: async () => {
      approved++;
      return true;
    },
  });
  const task = await mesh.execute({
    prompt: "Write a greeting",
    agentIds: [a.id],
  });
  assert.equal(task.status, "needs_review");
  assert.equal(approved, 1);
  assert.equal(
    fs.readFileSync(path.join(workspace, "hello.txt"), "utf8"),
    "Hello world",
  );
  assert.equal(task.toolEvents[0].status, "completed");
});
test("denied write does not modify workspace", async (t) => {
  const { store, workspace } = fixture(t);
  let n = 0;
  const url = await server(t, () =>
    ++n === 1
      ? {
          body: {
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "a",
                      type: "function",
                      function: {
                        name: "workspace_write",
                        arguments: '{"path":"denied.txt","content":"no"}',
                      },
                    },
                  ],
                },
              },
            ],
          },
        }
      : answer("Write was denied"),
  );
  const a = agent(store, url, "compatible", { allowEdits: true });
  const mesh = new Mesh(store, {
    workspaceRoot: workspace,
    trusted: () => true,
    confirm: async () => false,
  });
  const task = await mesh.execute({ prompt: "Write", agentIds: [a.id] });
  assert.equal(fs.existsSync(path.join(workspace, "denied.txt")), false);
  assert.equal(task.toolEvents[0].status, "failed");
});
test("cancel aborts active inference and marks remaining stages skipped", async (t) => {
  const { store } = fixture(t);
  let started;
  const ready = new Promise((r) => (started = r));
  const url = await server(t, async () => {
    started();
    await new Promise((r) => setTimeout(r, 150));
    return answer("Too late");
  });
  const a = agent(store, url);
  const mesh = new Mesh(store, { trusted: () => true });
  const running = mesh.execute({ prompt: "Wait", agentIds: [a.id, a.id] });
  await ready;
  mesh.cancel(store.data.tasks[0].id);
  const task = await running;
  assert.equal(task.status, "cancelled");
  assert.equal(task.steps[0].status, "cancelled");
  assert.equal(task.steps[1].status, "skipped");
  assert.equal(mesh.active.size, 0);
});
test("interrupted tasks remain recoverable after restart", (t) => {
  const { store } = fixture(t);
  store.data.tasks.push({
    id: "1",
    status: "running",
    steps: [{ status: "running" }, { status: "queued" }],
  });
  store.save();
  const fresh = new Store(path.dirname(store.file));
  assert.equal(fresh.data.tasks[0].status, "interrupted");
  assert.equal(fresh.data.tasks[0].steps[0].status, "interrupted");
});
test("vault selection, skill permissions, truthful exports and symlink boundaries", (t) => {
  const { store, workspace, dir } = fixture(t);
  fs.writeFileSync(path.join(workspace, "note.md"), "Project guidelines");
  store.data.knowledge = { vaultPath: workspace, notes: ["note.md"] };
  const skill = store.upsert("skills", {
    name: "Review",
    instructions: "Check failures",
  });
  const a = { skillIds: [skill.id] };
  const ctx = context(store.data, a);
  assert.match(ctx.text, /Project guidelines/);
  assert.match(ctx.text, /Check failures/);
  assert.throws(() => context(store.data, { skillIds: [] }, [skill.id]));
  assert.throws(() => inside(workspace, "../escape"));
  fs.symlinkSync(dir, path.join(workspace, "outside"));
  assert.throws(() => inside(workspace, "outside/private.txt"));
  const file = exportTask(store.data.knowledge, {
    id: "task-1",
    title: "Failed task",
    status: "failed",
    prompt: "Request",
    createdAt: "now",
    steps: [
      { role: "Reviewer", agentName: "A", status: "failed", error: "401" },
    ],
  });
  assert.match(fs.readFileSync(file, "utf8"), /Status: failed/);
  assert.doesNotMatch(fs.readFileSync(file, "utf8"), /Accepted|passed/);
});
test("Anthropic and Gemini requests preserve provider-specific response formats", async (t) => {
  for (const provider of ["anthropic", "gemini"]) {
    const { store } = fixture(t);
    const url = await server(t, (req, body) => {
      assert.ok(
        provider === "anthropic" ? body.system : body.systemInstruction,
      );
      return {
        body:
          provider === "anthropic"
            ? { content: [{ type: "text", text: "Anthropic response" }] }
            : {
                candidates: [
                  { content: { parts: [{ text: "Gemini response" }] } },
                ],
              },
      };
    });
    const a = agent(store, url, provider);
    const mesh = new Mesh(store, {
      trusted: () => true,
      getSecret: async () => "test-secret",
    });
    const task = await mesh.execute({
      prompt: "Hello",
      agentIds: [a.id],
      kind: "chat",
    });
    assert.equal(task.status, "completed");
    assert.equal(store.data.messages.length, 2);
    assert.match(task.steps[0].output, /response/);
  }
});
test("connection health uses model discovery and reports no secret values", async (t) => {
  const url = await server(t, (req) => {
    assert.equal(req.headers.authorization, "Bearer private-key");
    return { body: { data: [{ id: "available-model" }] } };
  });
  const result = await health(
    { mode: "api", provider: "openai", endpoint: url },
    "private-key",
  );
  assert.deepEqual(result.models, ["available-model"]);
  assert.doesNotMatch(JSON.stringify(result), /private-key/);
});
test("MCP stdio initialize, paginated discovery and tool calls", async (t) => {
  const { dir } = fixture(t);
  const file = path.join(dir, "mcp.cjs");
  fs.writeFileSync(
    file,
    `const rl=require('readline').createInterface({input:process.stdin});rl.on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;let result=q.method==='initialize'?{protocolVersion:'2024-11-05'}:q.method==='tools/list'?(q.params.cursor?{tools:[{name:'second',inputSchema:{type:'object'}}]}:{tools:[{name:'first',inputSchema:{type:'object'}}],nextCursor:'next'}):{content:[{type:'text',text:'tool output'}]};console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));});`,
  );
  const client = await connect(
    {
      transport: "stdio",
      executable: process.execPath,
      args: JSON.stringify([file]),
    },
    "",
  );
  try {
    assert.equal((await discover(client)).length, 2);
    const result = await client.rpc("tools/call", {
      name: "first",
      arguments: {},
    });
    assert.equal(result.content[0].text, "tool output");
  } finally {
    client.close();
  }
});
test("MCP connector tools are discoverable by API agents and require approval", async (t) => {
  const { store } = fixture(t);
  let toolUsed = false;
  const mcpUrl = await server(t, (req, q) => {
    if (q.method === "notifications/initialized") return { body: {} };
    return {
      body: {
        jsonrpc: "2.0",
        id: q.id,
        result:
          q.method === "initialize"
            ? { protocolVersion: "2024-11-05" }
            : q.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "lookup",
                      description: "Lookup",
                      inputSchema: { type: "object", properties: {} },
                    },
                  ],
                }
              : { content: [{ type: "text", text: "Found context" }] },
      },
    };
  });
  const apiUrl = await server(t, (req, body) => {
    if (body.messages.at(-1).role === "tool") {
      toolUsed = true;
      assert.match(body.messages.at(-1).content, /Found context/);
      return answer("Used connector");
    }
    const tool = body.tools.find((t) =>
      t.function.description.includes("lookup"),
    );
    assert.ok(tool);
    return {
      body: {
        choices: [
          {
            message: {
              content: "",
              tool_calls: [
                {
                  id: "1",
                  type: "function",
                  function: { name: tool.function.name, arguments: "{}" },
                },
              ],
            },
          },
        ],
      },
    };
  });
  const c = store.upsert("connectors", {
    name: "Lookup",
    transport: "http",
    endpoint: mcpUrl,
  });
  const a = agent(store, apiUrl, "compatible", { connectorIds: [c.id] });
  let approvals = 0;
  const mesh = new Mesh(store, {
    trusted: () => true,
    confirm: async () => {
      approvals++;
      return true;
    },
  });
  const task = await mesh.execute({ prompt: "Lookup", agentIds: [a.id] });
  assert.equal(task.status, "needs_review");
  assert.equal(toolUsed, true);
  assert.equal(approvals, 1);
});
test("custom CLI nonzero exit with stdout is a failure", async (t) => {
  const { store, dir } = fixture(t);
  const file = path.join(dir, "fail.cjs");
  fs.writeFileSync(file, "console.log('partial output');process.exit(7)");
  const c = store.upsert("connections", {
    name: "CLI",
    mode: "cli",
    provider: "custom",
    executable: process.execPath,
    args: JSON.stringify([file, "{prompt}"]),
  });
  const a = store.upsert("agents", {
    name: "CLI",
    connectionId: c.id,
    role: "Reviewer",
    skillIds: [],
    connectorIds: [],
  });
  const mesh = new Mesh(store, { trusted: () => true });
  const task = await mesh.execute({ prompt: "Run", agentIds: [a.id] });
  assert.equal(task.status, "failed");
  assert.match(task.error, /code 7/);
});
test("untrusted workspace blocks execution before creating a task", async (t) => {
  const { store } = fixture(t);
  const mesh = new Mesh(store);
  await assert.rejects(mesh.execute({ prompt: "x", agentIds: ["a"] }), /Trust/);
  assert.equal(store.data.tasks.length, 0);
});
test("standalone MCP responds to parse errors and advertises its tools", async (t) => {
  const { dir } = fixture(t);
  const child = spawn(
    process.execPath,
    ["src/mcp/mcpServer.js", "--data-dir", path.join(dir, "mcp")],
    { cwd: path.resolve(__dirname, ".."), stdio: ["pipe", "pipe", "pipe"] },
  );
  t.after(() => child.kill());
  let buffer = "";
  const responses = [];
  child.stdout.on("data", (b) => {
    buffer += b;
    let n;
    while ((n = buffer.indexOf("\n")) >= 0) {
      responses.push(JSON.parse(buffer.slice(0, n)));
      buffer = buffer.slice(n + 1);
    }
  });
  child.stdin.write(
    "bad\n" +
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) +
      "\n" +
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) +
      "\n",
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("No MCP responses")), 3000);
    const check = setInterval(() => {
      if (responses.length === 3) {
        clearInterval(check);
        clearTimeout(timer);
        resolve();
      }
    }, 10);
  });
  assert.equal(responses[0].error.code, -32700);
  assert.equal(responses[1].result.serverInfo.version, "2.0.0");
  assert.equal(responses[2].result.tools.length, 4);
});
test("Streamable HTTP MCP accepts SSE responses without waiting for stream closure", async (t) => {
  const s = http.createServer(async (req, res) => {
    let raw = "";
    for await (const b of req) raw += b;
    const q = JSON.parse(raw);
    if (q.id === undefined) {
      res.writeHead(202);
      res.end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "mcp-session-id": "fixture-session",
    });
    const result =
      q.method === "initialize"
        ? { protocolVersion: "2024-11-05" }
        : {
            tools: [{ name: "streamed_tool", inputSchema: { type: "object" } }],
          };
    res.write(
      "event: message\ndata: " +
        JSON.stringify({ jsonrpc: "2.0", id: q.id, result }) +
        "\n\n",
    );
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  t.after(() => {
    s.closeAllConnections();
    s.close();
  });
  const client = await connect(
    { transport: "http", endpoint: "http://127.0.0.1:" + s.address().port },
    "",
  );
  try {
    assert.equal((await discover(client))[0].name, "streamed_tool");
  } finally {
    client.close();
  }
});
test("task workspace is captured and retry cannot silently switch projects", async (t) => {
  const { store, workspace, dir } = fixture(t);
  let release, started;
  const ready = new Promise((r) => (started = r));
  const gate = new Promise((r) => (release = r));
  const url = await server(t, async () => {
    started();
    await gate;
    return answer("Finished original project");
  });
  const a = agent(store, url);
  const mesh = new Mesh(store, {
    workspaceRoot: workspace,
    trusted: () => true,
  });
  const running = mesh.execute({
    prompt: "Work",
    agentIds: [a.id],
    kind: "chat",
  });
  await ready;
  mesh.workspaceRoot = dir;
  release();
  const task = await running;
  assert.equal(task.workspaceRoot, workspace);
  assert.equal(store.data.messages.at(-1).workspaceRoot, workspace);
  assert.throws(() => mesh.retry(task.id), /original task workspace/);
});

test("pending approval becomes interrupted after restart rather than blocking the UI", (t) => {
  const { store } = fixture(t);
  store.data.tasks.push({
    id: "pending",
    status: "needs_input",
    steps: [{ status: "running" }],
  });
  store.save();
  const restored = new Store(path.dirname(store.file));
  assert.equal(restored.data.tasks[0].status, "interrupted");
  assert.equal(restored.data.tasks[0].steps[0].status, "interrupted");
});
