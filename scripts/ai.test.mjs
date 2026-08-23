import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isTrustedOllamaDownloadUrl,
  LocalAiService,
  ollamaCliAssetName,
  toolResultForModel,
} from "../dist-electron/main/ai.js";

test("Ollama setup selects standalone CLI archives and rejects desktop installers", () => {
  assert.equal(ollamaCliAssetName("win32", "x64"), "ollama-windows-amd64.zip");
  assert.equal(
    ollamaCliAssetName("win32", "arm64"),
    "ollama-windows-arm64.zip",
  );
  assert.equal(ollamaCliAssetName("darwin", "arm64"), "ollama-darwin.tgz");
  assert.equal(
    ollamaCliAssetName("linux", "x64"),
    "ollama-linux-amd64.tar.zst",
  );
  assert.equal(
    isTrustedOllamaDownloadUrl(
      "https://github.com/ollama/ollama/releases/download/v1.0.0/ollama-windows-amd64.zip",
    ),
    true,
  );
  assert.equal(
    isTrustedOllamaDownloadUrl("https://ollama.com/download/OllamaSetup.exe"),
    false,
  );
  assert.equal(
    isTrustedOllamaDownloadUrl("https://ollama.com/download/Ollama.dmg"),
    false,
  );
});

async function fixture({ grants = true } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-ai-test-"));
  const root = path.join(base, "project");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "index.ts"),
    "export const value = 1;\n",
  );
  const service = new LocalAiService({
    userData: path.join(base, "data"),
    modelsRoot: path.join(root, "models"),
    getProjectRoot: () => root,
    getPython: async () => "python",
    getUv: async () => "uv",
    status: () => undefined,
  });
  const chat = await service.createChat();
  if (grants) {
    await service.grantPermission(
      "project.read",
      "conversation",
      chat.id,
      "tests",
    );
    await service.grantPermission(
      "project.write",
      "conversation",
      chat.id,
      "tests",
    );
  }
  return { root, base, service, chat };
}

test("AI tools stay in the project and can edit when enabled", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const changed = new Set();
  const listed = JSON.parse(
    await service.runTool(
      { name: "list_files", arguments: {} },
      true,
      changed,
      [],
      true,
      false,
      chat.id,
    ),
  );
  assert.deepEqual(listed, ["src/index.ts"]);
  assert.match(
    await service.runTool(
      { name: "read_file", arguments: { path: "src/index.ts" } },
      true,
      changed,
      [],
      true,
      false,
      chat.id,
    ),
    /value = 1/,
  );
  await service.runTool(
    {
      name: "write_file",
      arguments: { path: "src/index.ts", content: "export const value = 2;\n" },
    },
    true,
    changed,
    [],
    true,
    false,
    chat.id,
  );
  await service.runTool(
    {
      name: "write_file",
      arguments: {
        path: "src/generated/result.ts",
        content: "export const generated = true;\n",
      },
    },
    true,
    changed,
    [],
    true,
    false,
    chat.id,
  );
  assert.deepEqual([...changed], ["src/index.ts", "src/generated/result.ts"]);
  assert.match(
    await fs.readFile(path.join(root, "src", "index.ts"), "utf8"),
    /value = 2/,
  );
  assert.match(
    await fs.readFile(path.join(root, "src", "generated", "result.ts"), "utf8"),
    /generated = true/,
  );
  await assert.rejects(
    service.runTool(
      { name: "read_file", arguments: { path: "../outside.txt" } },
      true,
      changed,
      [],
      true,
      false,
      chat.id,
    ),
    /inside the open project|outside the project/,
  );
});

test("successful command results tell small models to stop repeating verification", () => {
  const saved = toolResultForModel("write_file", "Saved src/index.ts");
  assert.match(saved, /Do not rewrite it again/);
  assert.match(saved, /verification next/);

  const success = toolResultForModel(
    "run_command",
    JSON.stringify({ exitCode: 0, stdout: "10\n", stderr: "" }),
  );
  assert.match(success, /VERIFIED/);
  assert.match(success, /Do not run the same command again/);
  assert.match(success, /complete_goal/);

  const failure = toolResultForModel(
    "run_command",
    JSON.stringify({ exitCode: 1, stdout: "", stderr: "failed" }),
  );
  assert.match(failure, /change the code or command/);
  assert.match(failure, /do not repeat the same failing call unchanged/);
});

test("AI write tool obeys the edit permission", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await assert.rejects(
    service.runTool(
      {
        name: "write_file",
        arguments: { path: "src/index.ts", content: "changed" },
      },
      false,
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
    /disabled/,
  );
});

test("AI file permission removes project access and checkpoints never touch Git", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await assert.rejects(
    service.runTool(
      { name: "read_file", arguments: { path: "src/index.ts" } },
      "ask",
      new Set(),
      [],
      false,
      false,
    ),
    /Permission required/,
  );
  await service.runTool(
    {
      name: "write_file",
      arguments: { path: "src/index.ts", content: "export const value = 9;\n" },
    },
    "auto",
    new Set(),
    [],
    true,
    false,
    chat.id,
  );
  const history = await service.listHistory();
  assert.equal(history.length, 1);
  assert.equal(
    await fs
      .stat(path.join(root, ".git"))
      .then(() => true)
      .catch(() => false),
    false,
  );
  assert.deepEqual(await service.revertHistory(history[0].id), [
    "src/index.ts",
  ]);
  assert.match(
    await fs.readFile(path.join(root, "src", "index.ts"), "utf8"),
    /value = 1/,
  );
});

test("disabled capabilities remain requestable and project questions ask before model inference", async (t) => {
  const { base, service, chat } = await fixture({ grants: false });
  t.after(() => fs.rm(base, { recursive: true, force: true }));

  const names = service
    .tools("ask", false, false, false, false)
    .map((item) => item.function.name);
  for (const name of [
    "list_files",
    "read_file",
    "write_file",
    "web_search",
    "web_fetch",
    "run_command",
  ])
    assert.ok(names.includes(name), `${name} should remain requestable`);

  let modelTurns = 0;
  let resumedMessages = [];
  service.remoteReply = async (_request, messages) => {
    modelTurns += 1;
    resumedMessages = messages;
    return {
      content: "This project exports a value from src/index.ts.",
      toolCalls: [],
    };
  };
  const request = {
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: false,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      { role: "user", content: "Can you tell me how this code works?" },
    ],
  };
  const waiting = await service.chat({ ...request, resumePermission: false });
  assert.equal(modelTurns, 0);
  assert.equal(waiting.permissionRequest.kind, "project.read");
  assert.match(waiting.content, /permission to read the project/i);

  await service.grantPermission(
    "project.read",
    "conversation",
    chat.id,
    "Inspect the open project",
  );
  const resumed = await service.chat({
    ...request,
    fileAccess: true,
    resumePermission: true,
  });
  assert.equal(modelTurns, 1);
  assert.match(resumed.content, /exports a value/);
  assert.ok(
    resumedMessages.some(
      (message) =>
        message.role === "tool" && /src\/index\.ts/.test(message.content),
    ),
  );
});

test("permission approval resumes the pending tool without asking the model again", async (t) => {
  const { base, service, chat } = await fixture({ grants: false });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turns = 0;
  let resumedMessages = [];
  service.remoteReply = async (_request, messages) => {
    turns += 1;
    if (turns === 1)
      return {
        content:
          '<oscode_tool>{"name":"read_file","arguments":{"path":"src/index.ts"}}</oscode_tool>',
        toolCalls: [],
      };
    resumedMessages = messages;
    return { content: "The project value is 1.", toolCalls: [] };
  };
  const request = {
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [{ role: "user", content: "Read the project value" }],
  };
  const waiting = await service.chat({ ...request, resumePermission: false });
  assert.equal(waiting.permissionRequest.kind, "project.read");
  await service.grantPermission(
    "project.read",
    "conversation",
    chat.id,
    "src/index.ts",
  );
  const resumed = await service.chat({ ...request, resumePermission: true });
  assert.equal(turns, 2);
  assert.match(resumed.content, /value is 1/);
  assert.ok(
    resumedMessages.some(
      (message) =>
        message.role === "tool" &&
        /export const value = 1/.test(message.content),
    ),
  );
});

test("fallback agent protocol edits for models without native tools", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turn = 0;
  service.remoteReply = async () =>
    turn++ === 0
      ? {
          content:
            '<oscode_tool>{"name":"write_file","arguments":{"path":"src/index.ts","content":"export const value = 3;\\n"}}</oscode_tool>',
          toolCalls: [],
        }
      : { content: "Updated src/index.ts.", toolCalls: [] };
  const result = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages: [{ role: "user", content: "Set value to 3" }],
  });
  assert.deepEqual(result.changedFiles, ["src/index.ts"]);
  assert.deepEqual(result.toolSteps, ["Edited src/index.ts"]);
  assert.match(result.content, /Tool-verified files changed/);
  assert.match(result.content, /`src\/index\.ts`/);
  assert.match(
    await fs.readFile(path.join(root, "src", "index.ts"), "utf8"),
    /value = 3/,
  );
});

test("256k chats compact locally and preserve Qwen reasoning separately", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  service.remoteReply = async () => ({
    content: "## Answer\n\nThe compacted context is ready.",
    thinking: "I checked the retained conversation context.",
    toolCalls: [],
  });
  const messages = Array.from({ length: 80 }, (_, index) => ({
    role: index % 2 ? "assistant" : "user",
    content: `${index}: ${"context ".repeat(2_500)}`,
  }));
  const result = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "osCode-fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 262144,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages,
  });
  assert.equal(result.usage.limit, 262144);
  assert.equal(result.usage.compacted, true);
  assert.ok(result.contextSummary.length > 0);
  assert.ok(result.retainedMessages.length < messages.length);
  assert.equal(result.thinking, "I checked the retained conversation context.");
  assert.match(result.content, /compacted context/);

  const continued = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "osCode-fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 262144,
    contextSummary: result.contextSummary,
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages: [
      ...result.retainedMessages,
      { role: "assistant", content: result.content, thinking: result.thinking },
      { role: "user", content: "Continue with the next task." },
    ],
  });
  assert.equal(continued.usage.compacted, false);
  assert.equal(continued.contextSummary, result.contextSummary);

  const repeated = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "osCode-fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 262144,
    contextSummary: continued.contextSummary,
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages: [
      ...result.retainedMessages,
      { role: "assistant", content: continued.content },
      ...Array.from({ length: 80 }, (_, index) => ({
        role: index % 2 ? "assistant" : "user",
        content: `second-window-${index}: ${"new context ".repeat(2_500)}`,
      })),
    ],
  });
  assert.equal(repeated.usage.compacted, true);
  assert.ok(repeated.retainedMessages.length < 82);
  assert.ok(repeated.contextSummary.length <= 64_000);
  assert.ok(
    (repeated.contextSummary.match(/(?:^|\n)user: 0: context/g) || []).length <=
      1,
  );
});

test("ask mode queues file edits until the user approves", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turn = 0;
  service.remoteReply = async () =>
    turn++ === 0
      ? {
          content:
            '<oscode_tool>{"name":"write_file","arguments":{"path":"src/index.ts","content":"export const value = 4;\\n"}}</oscode_tool>',
          toolCalls: [],
        }
      : { content: "The edit is ready for approval.", toolCalls: [] };
  const result = await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages: [{ role: "user", content: "Set value to 4" }],
  });
  assert.equal(result.pendingEdits.length, 1);
  assert.match(
    await fs.readFile(path.join(root, "src", "index.ts"), "utf8"),
    /value = 1/,
  );
  const changed = await service.resolveEdits(
    result.pendingEdits.map((edit) => edit.id),
    true,
  );
  assert.deepEqual(changed, ["src/index.ts"]);
  assert.match(
    await fs.readFile(path.join(root, "src", "index.ts"), "utf8"),
    /value = 4/,
  );
});

test("local models can own a chat goal, queue follow-up work, and schedule it", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const changed = new Set();
  await service.runTool(
    { name: "set_goal", arguments: { text: "Ship the parser" } },
    "auto",
    changed,
    [],
    false,
    false,
    chat.id,
  );
  await service.runTool(
    { name: "queue_task", arguments: { prompt: "Add parser tests" } },
    "auto",
    changed,
    [],
    false,
    false,
    chat.id,
  );
  await service.runTool(
    {
      name: "schedule_task",
      arguments: {
        prompt: "Run parser checks",
        next_run_at: new Date(Date.now() + 60_000).toISOString(),
        cadence: "daily",
      },
    },
    "auto",
    changed,
    [],
    false,
    false,
    chat.id,
  );
  const state = await service.getAgentState();
  assert.equal(state.goals[0].chatId, chat.id);
  assert.equal(state.goals[0].automatic, true);
  assert.equal(state.queue[0].automatic, true);
  assert.equal(state.schedules[0].automatic, true);
  assert.equal(state.schedules[0].cadence, "daily");
  assert.equal(state.goals[0].status, "active");
  await service.runTool(
    {
      name: "complete_goal",
      arguments: { evidence: ["scripts/parser.test.ts passes"] },
    },
    "auto",
    changed,
    [],
    false,
    false,
    chat.id,
  );
  const completed = await service.getAgentState();
  assert.equal(completed.goals[0].status, "complete");
});

test("local models cannot complete a goal without verification evidence", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const changed = new Set();
  await service.runTool(
    { name: "set_goal", arguments: { text: "Verify the parser" } },
    "auto",
    changed,
    [],
    false,
    false,
    chat.id,
  );
  await assert.rejects(
    service.runTool(
      { name: "complete_goal", arguments: { evidence: [] } },
      "auto",
      changed,
      [],
      false,
      false,
      chat.id,
    ),
    /verification evidence/,
  );
  const state = await service.getAgentState();
  assert.equal(state.goals[0].status, "active");
});

test("removing a local model forgets its reference without deleting the file", async (t) => {
  const { root, base, service } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const modelPath = path.join(root, "coder.gguf");
  await fs.writeFile(modelPath, "local model fixture");
  const model = {
    id: `llamacpp:${modelPath}`,
    name: "coder.gguf",
    engine: "llamacpp",
    path: modelPath,
    source: "local",
  };
  await service.registerModel(model);
  assert.ok((await service.listModels()).some((item) => item.id === model.id));
  await service.removeModel(model.id);
  assert.equal(
    (await service.listModels()).some((item) => item.id === model.id),
    false,
  );
  assert.equal(await fs.readFile(modelPath, "utf8"), "local model fixture");
});

test("custom models start at 8k and keep their configured context", async (t) => {
  const { root, base, service } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const modelPath = path.join(root, "custom-coder.gguf");
  await fs.writeFile(modelPath, "local model fixture");
  const model = await service.registerModel({
    id: `llamacpp:${modelPath}`,
    name: "custom-coder.gguf",
    engine: "llamacpp",
    path: modelPath,
    source: "local",
  });
  assert.equal(model.preferredContext, 8192);
  const configured = await service.updateModelContext(model.id, 32768);
  assert.equal(configured.preferredContext, 32768);
  assert.equal(
    (await service.listModels()).find((item) => item.id === model.id)
      ?.preferredContext,
    32768,
  );
});

test("downloaded osCode tiers can be deleted without touching custom models", async (t) => {
  const { root, base, service } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const tierRoot = path.join(root, "models", "gguf", "small");
  const shard = path.join(
    tierRoot,
    "osCode-GGUF-Small-Q4_K_M-00001-of-00002.gguf",
  );
  await fs.mkdir(tierRoot, { recursive: true });
  await fs.writeFile(shard, "test shard");
  const official = (await service.listModels()).find(
    (item) => item.tier === "small" && item.installed,
  );
  assert.ok(official);
  await service.removeModel(official.id);
  assert.equal(
    await fs
      .stat(tierRoot)
      .then(() => true)
      .catch(() => false),
    false,
  );
});

test("saved chats preserve reasoning, model identity, images, and prior turns", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const history = [
    {
      id: "first",
      role: "user",
      content: "Remember the first requirement.",
      createdAt: new Date().toISOString(),
    },
    {
      id: "second",
      role: "assistant",
      content: "I will keep it in this chat.",
      thinking: "Retain the requirement for the next turn.",
      assistantName: "Custom Model",
      createdAt: new Date().toISOString(),
      attachments: [
        {
          id: "image",
          name: "reference.png",
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AA==",
        },
      ],
    },
  ];
  await service.saveChat(chat.id, history, "Earlier work remains relevant.");
  const saved = (await service.getAgentState()).chats[0];
  assert.deepEqual(
    saved.messages.map((message) => message.content),
    history.map((message) => message.content),
  );
  assert.equal(saved.messages[1].thinking, history[1].thinking);
  assert.equal(saved.messages[1].assistantName, "Custom Model");
  assert.equal(saved.messages[1].attachments[0].name, "reference.png");
  assert.equal(saved.contextSummary, "Earlier work remains relevant.");

  let received = [];
  service.remoteReply = async (_request, messages) => {
    received = messages;
    return {
      content: "The first requirement is still in context.",
      toolCalls: [],
    };
  };
  await service.chat({
    chatId: chat.id,
    engine: "llamacpp",
    model: "fixture.gguf",
    executable: "",
    editMode: "ask",
    contextLimit: 8192,
    contextSummary: saved.contextSummary,
    goal: "",
    fileAccess: true,
    webAccess: false,
    messages: [
      ...saved.messages,
      { role: "user", content: "What did I ask first?" },
    ],
  });
  assert.ok(
    received.some(
      (message) => message.content === "Remember the first requirement.",
    ),
  );
  assert.ok(
    received.some((message) =>
      message.content.startsWith("I will keep it in this chat."),
    ),
  );
  assert.match(received[0].content, /Earlier work remains relevant/);
});

test("hardware recommendation starts every fresh installation on Small", async (t) => {
  const { base, service } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  assert.equal((await service.hardwareProfile()).recommendedTier, "small");
});
