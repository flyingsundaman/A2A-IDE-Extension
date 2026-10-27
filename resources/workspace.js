"use strict";
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
let state = null;
let page = vscode.getState()?.page || document.body.dataset.page;
const send = (command, data = {}) => {
  $("notice").hidden = true;
  vscode.postMessage({ command, ...data });
};
function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function button(text, action) {
  const b = node("button", text);
  b.type = "button";
  b.addEventListener("click", action);
  return b;
}
function go(next) {
  page = next;
  document
    .querySelectorAll(".page")
    .forEach((el) => (el.hidden = el.id !== next));
  document
    .querySelectorAll("nav [data-page]")
    .forEach((el) =>
      el.setAttribute(
        "aria-current",
        el.dataset.page === next ? "page" : "false",
      ),
    );
  vscode.setState({ page });
}
function options(select, items, placeholder = "Choose…") {
  const previous = select.value;
  select.replaceChildren(new Option(placeholder, ""));
  for (const item of items) select.add(new Option(item.name, item.id));
  if (items.some((x) => x.id === previous)) select.value = previous;
}
function checks(container, items, selected = []) {
  container.replaceChildren();
  for (const item of items) {
    const label = node("label", undefined, "check"),
      input = node("input");
    input.type = "checkbox";
    input.value = item.id;
    input.checked = selected.includes(item.id);
    label.append(input, document.createTextNode(item.name));
    container.append(label);
  }
}
const checked = (id) =>
  [...$(id).querySelectorAll("input:checked")].map((x) => x.value);
let filling = false;
const values = (form) => Object.fromEntries(new FormData(form));
function fill(form, value) {
  filling = true;
  form.reset();
  filling = false;
  for (const [key, v] of Object.entries(value)) {
    const input = form.elements.namedItem(key);
    if (input)
      input.type === "checkbox"
        ? (input.checked = !!v)
        : (input.value = typeof v === "string" ? v : "");
  }
}
function edit(collection, item) {
  const prefix = {
    connections: "connection",
    agents: "agent",
    connectors: "connector",
    skills: "skill",
  }[collection];
  fill($(prefix + "-form"), item);
  if (prefix === "agent") {
    checks($("agent-skills"), state.skills, item.skillIds);
    checks($("agent-connectors"), state.connectors, item.connectorIds);
    updateModels();
  }
  if (prefix === "connection") providerFields();
  if (prefix === "connector") connectorFields();
  $(prefix + "-editor").open = true;
  $(prefix + "-editor").scrollIntoView({ block: "center", behavior: "smooth" });
}
function rows(id, collection, description, actions) {
  const list = $(id);
  list.replaceChildren();
  if (!state[collection].length) {
    list.append(
      node("div", "No " + collection + " yet. Add one below.", "empty"),
    );
    return;
  }
  for (const item of state[collection]) {
    const row = node("div", undefined, "row"),
      body = node("div"),
      buttons = node("div", undefined, "actions");
    body.append(node("h3", item.name), node("p", description(item), "muted"));
    for (const [label, action] of actions(item))
      buttons.append(button(label, action));
    buttons.append(
      button("Edit", () => edit(collection, item)),
      button("Remove", () => send("remove", { collection, id: item.id })),
    );
    row.append(body, buttons);
    list.append(row);
  }
}
function providerFields() {
  const form = $("connection-form"),
    provider = form.elements.provider.value,
    cli = ["codex", "claude", "custom"].includes(provider);
  form.querySelector("[data-api]").hidden = cli;
  form.querySelector("[data-cli]").hidden = !cli;
  form.querySelector("[data-custom]").hidden = provider !== "custom";
  $("provider-help").textContent =
    provider === "custom"
      ? "Use an installed, trusted CLI with a supported non-interactive prompt command. Antigravity account login is not assumed; authenticate using the service’s official mechanism."
      : cli
        ? "Uses the official CLI on this machine. After saving, choose Login or test an existing local session. Connections to the same CLI share its current login; separate labels do not create isolated accounts."
        : "API access is separate from consumer subscriptions. Save, then Set key and Test to discover available models.";
}
function connectorFields() {
  const f = $("connector-form"),
    stdio = f.elements.transport.value === "stdio";
  f.querySelector("[data-stdio]").hidden = !stdio;
  f.querySelector("[data-http]").hidden = stdio;
}
function updateModels() {
  const c = $("agent-form").elements.connectionId.value;
  const models = state?.health[c]?.models || [];
  $("models").replaceChildren(...models.map((id) => new Option(id, id)));
}
function updateChatContext() {
  const agent = state?.agents.find((a) => a.id === $("chat-agent").value);
  $("chat-context").textContent = agent
    ? `${agent.role} · ${agent.model || "CLI default model"} · ${state.knowledge.notes.length} selected notes · ${(agent.skillIds || []).length} skills · ${(agent.connectorIds || []).length} connectors`
    : "Add an agent on Agents & Connections to start.";
  renderMessages();
}
function renderMessages() {
  if (!state) return;
  const feed = $("messages");
  const agentId = $("chat-agent").value;
  feed.replaceChildren();
  for (const m of state.messages.filter(
    (m) => m.agentId === agentId && m.workspaceRoot === state.workspaceRoot,
  )) {
    const el = node("article", undefined, "message");
    el.append(
      node(
        "div",
        (m.role === "user" ? "You" : m.name || "Agent") +
          " · " +
          new Date(m.at).toLocaleString(),
        "meta",
      ),
      node("pre", m.text, "content"),
    );
    feed.append(el);
  }
}
function addStage(selected = "") {
  const div = node("div", undefined, "stage"),
    number = node("span"),
    select = node("select");
  select.setAttribute("aria-label", "Stage agent");
  options(select, state?.agents || [], "Choose agent");
  if (selected) select.value = selected;
  div.append(
    number,
    select,
    button("Remove", () => {
      div.remove();
      numberStages();
    }),
  );
  $("stage-list").append(div);
  numberStages();
}
function numberStages() {
  [...$("stage-list").children].forEach(
    (el, i) => (el.firstChild.textContent = String(i + 1).padStart(2, "0")),
  );
}
function renderTasks() {
  const list = $("task-list");
  const openIds = new Set(
    [...list.querySelectorAll("details[open]")].map((x) => x.dataset.id),
  );
  list.replaceChildren();
  let tasks = [...state.tasks].reverse();
  const filter = $("task-filter").value;
  if (["task", "chat"].includes(filter))
    tasks = tasks.filter((t) => t.kind === filter);
  if (filter === "attention")
    tasks = tasks.filter((t) =>
      ["failed", "needs_review", "needs_input", "interrupted"].includes(
        t.status,
      ),
    );
  if (!tasks.length)
    list.append(node("div", "No matching activity yet.", "empty"));
  for (const t of tasks) {
    const details = node("details", undefined, "task");
    details.dataset.id = t.id;
    details.open = openIds.has(t.id);
    const summary = node("summary");
    summary.append(
      node("span", t.title),
      node("span", t.status.replaceAll("_", " "), "status"),
    );
    details.append(
      summary,
      node(
        "p",
        `${t.kind} · ${new Date(t.createdAt).toLocaleString()} · ${t.workspaceRoot || "No workspace"}`,
        "hint",
      ),
      node("pre", t.prompt, "content"),
    );
    if (t.sources?.length)
      details.append(node("p", t.sources.join(" · "), "sources"));
    for (const s of t.steps) {
      const section = node("div", undefined, "step");
      section.append(
        node("h3", s.role + " — " + s.agentName),
        node("p", s.status.replaceAll("_", " "), "status"),
      );
      if (s.output) section.append(node("pre", s.output, "content"));
      if (s.error) section.append(node("p", s.error, "error"));
      details.append(section);
    }
    if (t.toolEvents?.length)
      details.append(
        node(
          "p",
          "Tools: " +
            t.toolEvents.map((e) => e.tool + " (" + e.status + ")").join(" · "),
          "hint",
        ),
      );
    if (t.error) details.append(node("p", t.error, "error"));
    if (t.exportedTo)
      details.append(node("p", "Exported: " + t.exportedTo, "sources"));
    if (t.exportError)
      details.append(node("p", "Export failed: " + t.exportError, "error"));
    const actions = node("div", undefined, "actions");
    if (["queued", "running", "needs_input"].includes(t.status))
      actions.append(button("Cancel", () => send("cancel", { id: t.id })));
    else {
      actions.append(
        button("Retry as new run", () => send("retry", { id: t.id })),
      );
      if (t.status === "needs_review")
        actions.append(
          button("Accept result", () => send("accept", { id: t.id })),
        );
      actions.append(
        button("Export to Obsidian", () => send("exportTask", { id: t.id })),
      );
      if (t.kind === "task") {
        const form = node("form", undefined, "revision"),
          label = node("label", "Revision instructions"),
          input = node("textarea");
        input.rows = 2;
        input.required = true;
        input.placeholder = "Describe findings or changes needed";
        label.append(input);
        form.append(
          label,
          button("Run revision", () => {
            if (input.reportValidity())
              send("revise", { id: t.id, prompt: input.value });
          }),
        );
        details.append(form);
      }
    }
    details.append(actions);
    list.append(details);
  }
}
function render() {
  $("trust").hidden = state.trusted;
  rows(
    "connection-list",
    "connections",
    (c) =>
      `${c.provider} · ${c.mode === "cli" ? "Local CLI" : c.endpoint} · ${state.health[c.id]?.status?.replaceAll("_", " ") || "Not tested"}${c.hasSecret ? " · Key saved" : ""}`,
    (c) => [
      ["Test", () => send("testConnection", { id: c.id })],
      ...(c.mode === "cli" && ["codex", "claude"].includes(c.provider)
        ? [["Login", () => send("login", { id: c.id })]]
        : []),
      ...(c.mode === "api"
        ? [
            [
              "Set key",
              () => send("setSecret", { kind: "connection", id: c.id }),
            ],
            ...(c.hasSecret
              ? [
                  [
                    "Clear key",
                    () => send("clearSecret", { kind: "connection", id: c.id }),
                  ],
                ]
              : []),
          ]
        : []),
    ],
  );
  // Health details never include credentials or raw authentication responses.
  for (const c of state.connections) {
    const detail = state.health[c.id]?.detail;
    if (detail) {
      const index = state.connections.indexOf(c);
      $("connection-list").children[index]?.firstChild.append(
        node("p", detail, "hint"),
      );
    }
  }
  rows(
    "agent-list",
    "agents",
    (a) =>
      `${a.role} · ${state.connections.find((c) => c.id === a.connectionId)?.name || "Missing connection"} · ${a.model || "Default model"} · ${a.allowEdits ? "Edits allowed" : "Read only"}`,
    (a) => [
      [
        "Chat",
        () => {
          $("chat-agent").value = a.id;
          go("chat");
          updateChatContext();
        },
      ],
    ],
  );
  rows(
    "connector-list",
    "connectors",
    (c) =>
      `${c.transport} · ${c.endpoint || c.executable}${c.hasSecret ? " · Credential saved" : ""}`,
    (c) => [
      ["Test", () => send("testConnector", { id: c.id })],
      [
        "Set credential",
        () => send("setSecret", { kind: "connector", id: c.id }),
      ],
      ...(c.hasSecret
        ? [
            [
              "Clear credential",
              () => send("clearSecret", { kind: "connector", id: c.id }),
            ],
          ]
        : []),
    ],
  );
  rows(
    "skill-list",
    "skills",
    (s) =>
      s.instructions.slice(0, 120) + (s.instructions.length > 120 ? "…" : ""),
    () => [],
  );
  const skillSelection = checked("agent-skills"),
    connectorSelection = checked("agent-connectors");
  checks($("agent-skills"), state.skills, skillSelection);
  checks($("agent-connectors"), state.connectors, connectorSelection);
  options($("agent-form").elements.connectionId, state.connections);
  options($("chat-agent"), state.agents, "Choose an agent");
  if (!$("chat-agent").value && state.agents.length)
    $("chat-agent").value = state.agents[0].id;
  updateModels();
  updateChatContext();
  $("vault-path").textContent =
    state.knowledge.vaultPath ||
    "No vault connected. Select a folder to begin.";
  $("vault-error").textContent = state.knowledgeError;
  checks(
    $("notes"),
    state.availableNotes.map((name) => ({ id: name, name })),
    state.knowledge.notes,
  );
  $("knowledge-form").elements.autoExport.checked = state.knowledge.autoExport;
  const busy = state.tasks.find((t) =>
    ["queued", "running", "needs_input"].includes(t.status),
  );
  $("send").disabled = !!busy || !state.agents.length || !state.trusted;
  $("start-task").disabled = $("send").disabled;
  $("active-task").hidden = !busy;
  if (busy) {
    $("active-task").replaceChildren(
      document.createTextNode(
        busy.title + " · " + busy.status.replaceAll("_", " ") + " ",
      ),
      button("View task", () => go("tasks")),
      button("Cancel", () => send("cancel", { id: busy.id })),
    );
  }
  $("task-count").textContent = busy ? "· active" : "";
  for (const select of $("stage-list").querySelectorAll("select"))
    options(select, state.agents, "Choose agent");
  if (!$("stage-list").children.length) addStage();
  renderTasks();
}
for (const b of document.querySelectorAll("nav [data-page]"))
  b.addEventListener("click", () => go(b.dataset.page));
$("open-full").onclick = () => send("openFull", { page });
$("detect").onclick = () => send("detect");
$("connection-form").elements.provider.onchange = providerFields;
$("connector-form").elements.transport.onchange = connectorFields;
$("agent-form").elements.connectionId.onchange = updateModels;
for (const prefix of ["connection", "agent", "connector", "skill"]) {
  const form = $(prefix + "-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = values(form);
    if (prefix === "connection")
      value.mode = ["codex", "claude", "custom"].includes(value.provider)
        ? "cli"
        : "api";
    if (prefix === "agent") {
      value.allowEdits = form.elements.allowEdits.checked;
      value.skillIds = checked("agent-skills");
      value.connectorIds = checked("agent-connectors");
    }
    send("save" + prefix[0].toUpperCase() + prefix.slice(1), { value });
  });
  form.addEventListener("reset", () => {
    if (filling) return;
    setTimeout(() => {
      form.elements.id.value = "";
      if (prefix === "connection") providerFields();
      if (prefix === "connector") connectorFields();
      if (prefix === "agent") {
        checks($("agent-skills"), state?.skills || []);
        checks($("agent-connectors"), state?.connectors || []);
      }
    }, 0);
  });
}
$("pick-vault").onclick = () => send("pickVault");
$("disconnect-vault").onclick = () => send("disconnectVault");
$("import-skill").onclick = () => send("importSkill");
$("knowledge-form").onsubmit = (e) => {
  e.preventDefault();
  send("saveKnowledge", {
    notes: checked("notes"),
    autoExport: e.target.elements.autoExport.checked,
  });
};
$("chat-agent").onchange = updateChatContext;
$("clear-chat").onclick = () => send("clearChat");
$("chat-form").onsubmit = (e) => {
  e.preventDefault();
  if ($("send").disabled) return;
  const prompt = $("prompt").value.trim();
  if (!prompt || !$("chat-agent").value) return;
  send("send", { prompt, agentId: $("chat-agent").value });
  $("prompt").value = "";
};
$("prompt").onkeydown = (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    $("chat-form").requestSubmit();
    e.preventDefault();
  }
};
$("to-task").onclick = () => {
  const prompt = $("prompt").value.trim();
  $("task-form").elements.prompt.value = prompt;
  $("task-form").elements.title.value = prompt.slice(0, 70);
  $("task-editor").open = true;
  go("tasks");
};
$("add-stage").onclick = () => {
  if ($("stage-list").children.length < 6) addStage();
};
$("task-form").onsubmit = (e) => {
  e.preventDefault();
  if ($("start-task").disabled) return;
  const data = values(e.target);
  const agentIds = [...$("stage-list").querySelectorAll("select")].map(
    (s) => s.value,
  );
  if (!agentIds.length || agentIds.some((x) => !x)) {
    $("notice").textContent = "Choose an agent for every stage.";
    $("notice").hidden = false;
    return;
  }
  send("runTask", { ...data, agentIds });
};
$("task-filter").onchange = renderTasks;
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "state") {
    state = msg.state;
    render();
  }
  if (msg.type === "navigate") go(msg.page);
  if (msg.type === "error") {
    $("notice").textContent = msg.message;
    $("notice").className = "error";
    $("notice").hidden = false;
  }
  if (msg.type === "done") {
    const prefix = {
      saveConnection: "connection",
      saveAgent: "agent",
      saveConnector: "connector",
      saveSkill: "skill",
    }[msg.command];
    if (prefix) {
      $(prefix + "-form").reset();
      $(prefix + "-editor").open = false;
    }
    if (
      ![
        "ready",
        "openFull",
        "send",
        "runTask",
        "retry",
        "revise",
        "cancel",
      ].includes(msg.command)
    ) {
      $("notice").textContent =
        {
          saveConnection: "Connection saved.",
          saveAgent: "Agent saved.",
          saveConnector: "Connector saved.",
          saveSkill: "Skill saved.",
          saveKnowledge: "Context saved.",
          testConnection: "Connection test finished. See its status below.",
          testConnector: "Connector test finished.",
          setSecret: "Credential prompt closed.",
          clearSecret: "Credential action completed.",
          pickVault: "Vault selection updated.",
          accept: "Task result accepted.",
          exportTask: "Task exported.",
          detect: "Local CLI detection finished.",
        }[msg.command] || "Action completed.";
      $("notice").className = "";
      $("notice").hidden = false;
    }
  }
});
providerFields();
connectorFields();
go(page);
send("ready");
