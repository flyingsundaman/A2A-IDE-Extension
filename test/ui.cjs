"use strict";
// Real Chromium UI + extension message handler + local provider fixture; no paid API calls.
const { chromium } = require("playwright");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { Store } = require("../src/runtime/store");
const { Mesh } = require("../src/runtime/mesh");
(async () => {
  const root = path.resolve(__dirname, "..");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mesh-ui-"));
  const workspace = path.join(temp, "workspace");
  fs.mkdirSync(workspace);
  const vault = path.join(temp, "vault");
  fs.mkdirSync(vault);
  fs.writeFileSync(path.join(vault, "Architecture.md"), "Keep modules small.");
  const secrets = new Map();
  const store = new Store(path.join(temp, "data"));
  let inference = 0;
  const errors = [];
  let provider, browser, base;
  const mock = {
    window: {
      showInputBox: async () => "browser-test-key",
      showWarningMessage: async (_m, _o, choice) => choice,
      showInformationMessage: async () => {},
      showOpenDialog: async () => [{ fsPath: vault }],
    },
  };
  const original = Module._load;
  Module._load = function (name, ...args) {
    return name === "vscode" ? mock : original.call(this, name, ...args);
  };
  const { SquadWebviewProvider } = require("../src/ui/squadWebview");
  Module._load = original;
  const mesh = new Mesh(store, {
    workspaceRoot: workspace,
    trusted: () => true,
    getSecret: async (key) => secrets.get(key),
    confirm: async () => true,
  });
  provider = new SquadWebviewProvider(
    {
      extensionPath: root,
      secrets: {
        get: async (key) => secrets.get(key),
        store: async (key, value) => secrets.set(key, value),
        delete: async (key) => secrets.delete(key),
      },
    },
    mesh,
  );
  const streams = new Set();
  const broadcast = async () => {
    const message =
      "data: " +
      JSON.stringify({ type: "state", state: await provider.snapshot() }) +
      "\n\n";
    for (const res of streams) res.write(message);
  };
  mesh.on("change", broadcast);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        });
        streams.add(res);
        req.on("close", () => streams.delete(res));
        return;
      }
      if (req.url === "/command") {
        let text = "";
        for await (const b of req) text += b;
        const command = JSON.parse(text);
        try {
          await provider.handle(command);
          res.end(
            JSON.stringify([
              { type: "state", state: await provider.snapshot() },
              { type: "done", command: command.command },
            ]),
          );
        } catch (e) {
          res.end(JSON.stringify([{ type: "error", message: e.message }]));
        }
        return;
      }
      if (req.url === "/api/models") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ id: "test-model" }] }));
        return;
      }
      if (req.url === "/api/chat/completions") {
        let raw = "";
        for await (const b of req) raw += b;
        const data = JSON.parse(raw);
        assert.equal(data.model, "test-model");
        inference++;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content:
                    "Fixture response " +
                    inference +
                    ": request completed. No audit verdict is implied.",
                },
              },
            ],
          }),
        );
        return;
      }
      if (req.url === "/") {
        let html = fs
          .readFileSync(path.join(root, "resources/workspace.html"), "utf8")
          .replaceAll("{{CSP}}", base)
          .replaceAll("{{NONCE}}", "testing")
          .replace("{{CSS}}", "/workspace.css")
          .replace("{{JS}}", "/workspace.js")
          .replace("{{PAGE}}", "agents");
        const bridge = `<script nonce="testing">const events=new EventSource('/events');events.onmessage=e=>window.dispatchEvent(new MessageEvent('message',{data:JSON.parse(e.data)}));window.acquireVsCodeApi=()=>({getState:()=>JSON.parse(sessionStorage.getItem('view')||'null'),setState:s=>sessionStorage.setItem('view',JSON.stringify(s)),postMessage:async command=>{const r=await fetch('/command',{method:'POST',body:JSON.stringify(command)});for(const data of await r.json())window.dispatchEvent(new MessageEvent('message',{data}));}});</script>`;
        html = html
          .replace(
            "default-src 'none';",
            "default-src 'none'; connect-src " + base + ";",
          )
          .replace(
            '<script nonce="testing" src=',
            bridge + '<script nonce="testing" src=',
          );
        res.setHeader("content-type", "text/html");
        res.end(html);
        return;
      }
      const file = path.join(root, "resources", path.basename(req.url));
      res.setHeader(
        "content-type",
        req.url.endsWith(".css") ? "text/css" : "application/javascript",
      );
      res.end(fs.readFileSync(file));
    } catch (e) {
      errors.push(e.message);
      res.writeHead(500);
      res.end(e.message);
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
      colorScheme: "dark",
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.getByText("No connections yet. Add one below.").waitFor();
    await page.locator("#connection-editor summary").click();
    await page.locator("#connection-form [name=name]").fill("Local test API");
    await page
      .locator("#connection-form [name=provider]")
      .selectOption("compatible");
    await page.locator("#connection-form [name=endpoint]").fill(base + "/api");
    await page
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    await page
      .locator("#connection-list h3")
      .filter({ hasText: "Local test API" })
      .waitFor();
    await page
      .locator("#connection-list")
      .getByRole("button", { name: "Set key", exact: true })
      .click();
    await page.getByText(/Key saved/).waitFor();
    await page
      .locator("#connection-list")
      .getByRole("button", { name: "Test", exact: true })
      .click();
    await page.getByText(/Provider responded to model discovery/).waitFor();
    await page
      .getByRole("button", { name: "Knowledge & Skills", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Choose vault", exact: true })
      .click();
    await page.getByLabel("Architecture.md", { exact: true }).check();
    await page
      .getByRole("button", { name: "Save context", exact: true })
      .click();
    await page.locator("#skill-editor summary").click();
    await page.locator("#skill-form [name=name]").fill("Careful review");
    await page
      .locator("#skill-form [name=instructions]")
      .fill("Report failures honestly.");
    await page.getByRole("button", { name: "Save skill", exact: true }).click();
    await page
      .locator("#skill-list h3")
      .filter({ hasText: "Careful review" })
      .waitFor();
    await page
      .getByRole("button", { name: "Agents & Connections", exact: true })
      .click();
    await page.locator("#agent-editor summary").click();
    await page.locator("#agent-form [name=name]").fill("Project agent");
    await page
      .locator("#agent-form [name=connectionId]")
      .selectOption(store.data.connections[0].id);
    await page.locator("#agent-form [name=model]").fill("test-model");
    await page.getByLabel("Careful review", { exact: true }).check();
    await page.getByRole("button", { name: "Save agent", exact: true }).click();
    await page
      .locator("#agent-list h3")
      .filter({ hasText: "Project agent" })
      .waitFor();
    await page
      .locator("#agent-list")
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page.locator("#agent-form [name=name]").fill("Updated agent");
    await page.getByRole("button", { name: "Save agent", exact: true }).click();
    await page
      .locator("#agent-list h3")
      .filter({ hasText: "Updated agent" })
      .waitFor();
    assert.equal(
      store.data.agents.length,
      1,
      "Editing must update rather than duplicate",
    );
    assert.equal(store.data.agents[0].skillIds.length, 1);
    await page
      .locator("#agent-list")
      .getByRole("button", { name: "Chat", exact: true })
      .click();
    await page.locator("#prompt").fill("Hello agent");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page
      .locator("#messages")
      .getByText(/Fixture response 1/)
      .waitFor();
    await page.locator("#prompt").fill("Plan and review a feature");
    await page
      .getByRole("button", { name: "Create task from message", exact: true })
      .click();
    await page
      .locator("#stage-list select")
      .selectOption(store.data.agents[0].id);
    await page.getByRole("button", { name: "Add stage", exact: true }).click();
    await page
      .locator("#stage-list select")
      .nth(1)
      .selectOption(store.data.agents[0].id);
    await page.getByRole("button", { name: "Start task", exact: true }).click();
    await page
      .locator("#task-list summary")
      .filter({ hasText: "needs review" })
      .waitFor();
    const task = page.locator("#task-list details").first();
    await task.locator("summary").click();
    await task.getByText(/Fixture response 3/).waitFor();
    await task
      .getByRole("button", { name: "Export to Obsidian", exact: true })
      .click();
    await task.getByText(/Exported:/).waitFor();
    await task
      .getByRole("button", { name: "Accept result", exact: true })
      .click();
    await page
      .locator("#task-list details")
      .first()
      .locator("summary")
      .filter({ hasText: "completed" })
      .waitFor();
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    await page.screenshot({
      path: path.join(root, "artifacts/tasks-desktop.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Agents & Connections", exact: true })
      .click();
    await page.screenshot({
      path: path.join(root, "artifacts/agents-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.screenshot({
      path: path.join(root, "artifacts/agents-mobile.png"),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "No horizontal overflow on a narrow panel",
    );
    await page.reload();
    await page
      .locator("#agent-list h3")
      .filter({ hasText: "Updated agent" })
      .waitFor();
    assert.equal(await page.locator("svg, .avatar, .icon").count(), 0);
    assert.equal(inference, 3);
    assert.deepEqual(errors, []);
    const persisted = new Store(path.dirname(store.file));
    assert.equal(persisted.data.agents[0].name, "Updated agent");
    assert.equal(persisted.data.tasks.length, 2);
    assert.doesNotMatch(
      fs.readFileSync(store.file, "utf8"),
      /browser-test-key/,
    );
    console.log(
      "PASS Chromium: connection/key/test, vault/skill, agent create/edit, chat, two-stage task, export/accept, persistence, narrow layout, no icons or browser errors.",
    );
  } finally {
    await browser?.close();
    mesh.dispose();
    provider.dispose();
    for (const stream of streams) stream.end();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
