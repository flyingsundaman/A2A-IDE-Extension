"use strict";
const { executable, run } = require("./process");
const { request } = require("./http");
const defaults = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  compatible: "http://localhost:11434/v1",
};
async function health(connection, secret) {
  if (connection.mode === "cli") {
    const file = executable(connection.executable || connection.provider);
    if (!file)
      return {
        status: "unavailable",
        detail: "Executable not found on this machine.",
      };
    const args =
      connection.provider === "codex"
        ? ["login", "status"]
        : connection.provider === "claude"
          ? ["auth", "status"]
          : ["--version"];
    const result = await run(file, args, { timeout: 10000 });
    if (result.code !== 0)
      return {
        status: "needs_login",
        detail: "CLI authentication check failed. Use Login, then test again.",
      };
    if (connection.provider === "claude") {
      try {
        if (JSON.parse(result.stdout).loggedIn === false)
          return { status: "needs_login", detail: "Claude is not logged in." };
      } catch {}
    }
    return {
      status: connection.provider === "custom" ? "detected" : "authenticated",
      detail:
        connection.provider === "custom"
          ? "Executable found; request has not been tested."
          : "CLI reports an authenticated session; model execution is checked when a task runs.",
    };
  }
  if (!secret && connection.provider !== "compatible")
    return { status: "needs_key", detail: "Add an API key using Set key." };
  const base = connection.endpoint || defaults[connection.provider];
  const headers =
    connection.provider === "anthropic"
      ? { "x-api-key": secret, "anthropic-version": "2023-06-01" }
      : connection.provider === "gemini"
        ? { "x-goog-api-key": secret }
        : secret
          ? { Authorization: `Bearer ${secret}` }
          : {};
  const result = await request(base + "/models", { headers });
  const json = JSON.parse(result.text);
  return {
    status: "connected",
    detail:
      "Provider responded to model discovery. Inference permissions and quota are checked on execution.",
    models: (json.data || json.models || [])
      .map((x) => x.id || x.name?.replace(/^models\//, ""))
      .filter(Boolean)
      .slice(0, 100),
  };
}
async function cli(connection, agent, messages, cwd, signal) {
  const file = executable(connection.executable || connection.provider);
  if (!file)
    throw new Error("CLI not found. Edit the connection executable path.");
  const prompt = messages
    .map(
      (m) =>
        `${m.role.toUpperCase()}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
    )
    .join("\n\n");
  let args;
  if (connection.provider === "codex")
    args = [
      "exec",
      "--sandbox",
      agent.allowEdits ? "workspace-write" : "read-only",
      ...(agent.model ? ["--model", agent.model] : []),
      prompt,
    ];
  else if (connection.provider === "claude") {
    const tools = agent.allowEdits
      ? "Read,Glob,Grep,Edit,Write"
      : "Read,Glob,Grep";
    args = [
      "-p",
      prompt,
      "--output-format",
      "text",
      "--permission-mode",
      "dontAsk",
      "--tools",
      tools,
      "--allowedTools",
      tools,
      ...(agent.model ? ["--model", agent.model] : []),
    ];
  } else {
    args = JSON.parse(connection.args || '["{prompt}"]');
    if (
      !Array.isArray(args) ||
      !args.every((a) => typeof a === "string") ||
      !args.some((a) => a.includes("{prompt}"))
    )
      throw new Error(
        "Custom CLI args must be a JSON array containing {prompt}.",
      );
    args = args.map((a) => a.replaceAll("{prompt}", prompt));
  }
  const result = await run(file, args, { cwd, signal, timeout: 600000 });
  if (result.code !== 0)
    throw new Error(
      `CLI exited with code ${result.code}. ${result.stderr.slice(-1200) || "No error details returned."}`,
    );
  if (!result.stdout) throw new Error("CLI returned an empty response.");
  return result.stdout;
}
async function completion(connection, agent, messages, tools, secret, signal) {
  const base = connection.endpoint || defaults[connection.provider];
  let url,
    body,
    headers = { "Content-Type": "application/json" };
  if (connection.provider === "anthropic") {
    url = base + "/messages";
    headers["x-api-key"] = secret;
    headers["anthropic-version"] = "2023-06-01";
    body = {
      model: agent.model,
      max_tokens: 8192,
      system: messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n"),
      messages: [],
    };
    for (const m of messages.filter((m) => m.role !== "system")) {
      if (m.role === "tool")
        body.messages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: m.tool_call_id,
              content: m.content,
            },
          ],
        });
      else if (m.tool_calls)
        body.messages.push({
          role: "assistant",
          content: [
            ...(m.content ? [{ type: "text", text: m.content }] : []),
            ...m.tool_calls.map((t) => ({
              type: "tool_use",
              id: t.id,
              name: t.function.name,
              input: JSON.parse(t.function.arguments),
            })),
          ],
        });
      else body.messages.push({ role: m.role, content: m.content });
    }
    if (tools.length)
      body.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
  } else if (connection.provider === "gemini") {
    url = `${base}/models/${encodeURIComponent(agent.model)}:generateContent`;
    headers["x-goog-api-key"] = secret;
    body = {
      systemInstruction: {
        parts: [
          {
            text: messages
              .filter((m) => m.role === "system")
              .map((m) => m.content)
              .join("\n"),
          },
        ],
      },
      contents: [],
    };
    for (const m of messages.filter((m) => m.role !== "system")) {
      const parts =
        m.role === "tool"
          ? [
              {
                functionResponse: {
                  name: m.name,
                  response: { result: m.content },
                },
              },
            ]
          : [
              ...(m.content ? [{ text: m.content }] : []),
              ...(m.tool_calls || []).map((t) => ({
                functionCall: {
                  name: t.function.name,
                  args: JSON.parse(t.function.arguments),
                  ...(t.signature ? {} : {}),
                },
                ...(t.signature ? { thoughtSignature: t.signature } : {}),
              })),
            ];
      // Gemini requires consecutive function results to belong to one user turn.
      const role = m.role === "assistant" ? "model" : "user";
      const previous = body.contents.at(-1);
      if (
        m.role === "tool" &&
        previous?.role === "user" &&
        previous.parts[0]?.functionResponse
      )
        previous.parts.push(...parts);
      else body.contents.push({ role, parts });
    }
    if (tools.length)
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
  } else {
    url = base + "/chat/completions";
    if (secret) headers.Authorization = `Bearer ${secret}`;
    body = { model: agent.model, messages };
    if (tools.length)
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
  }
  const data = JSON.parse(
    (
      await request(
        url,
        { method: "POST", headers, body: JSON.stringify(body) },
        signal,
      )
    ).text,
  );
  let text, calls;
  if (connection.provider === "anthropic") {
    text = (data.content || [])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    calls = (data.content || [])
      .filter((p) => p.type === "tool_use")
      .map((p) => ({
        id: p.id,
        type: "function",
        function: { name: p.name, arguments: JSON.stringify(p.input) },
      }));
  } else if (connection.provider === "gemini") {
    const parts = data.candidates?.[0]?.content?.parts || [];
    text = parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("\n");
    calls = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: `gemini-${i}`,
        type: "function",
        signature: p.thoughtSignature,
        function: {
          name: p.functionCall.name,
          arguments: JSON.stringify(p.functionCall.args || {}),
        },
      }));
  } else {
    text = data.choices?.[0]?.message?.content || "";
    calls = data.choices?.[0]?.message?.tool_calls || [];
  }
  if (!text && !calls?.length)
    throw new Error(
      "Provider returned no text or tool calls. Check model capabilities or content filters.",
    );
  return {
    role: "assistant",
    content: text || "",
    ...(calls?.length ? { tool_calls: calls } : {}),
  };
}
module.exports = { defaults, health, cli, completion };
