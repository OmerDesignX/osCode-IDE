import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isTrustedOllamaDownloadUrl,
  isPackageInstallCommand,
  LocalAiService,
  ollamaCliAssetName,
  toolResultForModel,
} from "../dist-electron/main/ai.js";
import {
  filesForVariant,
  modelVariants,
} from "../dist-electron/main/model-catalog.js";

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

async function fixture({
  grants = true,
  status = () => undefined,
  installPythonPackages,
} = {}) {
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
    ...(installPythonPackages ? { installPythonPackages } : {}),
    status,
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

test("Ollama streams reasoning, answer progress, and native tool calls", async (t) => {
  const statuses = [];
  const { base, service } = await fixture({
    status: (value) => statuses.push(value),
  });
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const chunks = [
    JSON.stringify({
      message: { thinking: "Inspect the project. " },
      eval_count: 4,
      done: false,
    }),
    JSON.stringify({
      message: {
        content: "I found the next step.",
        tool_calls: [
          {
            id: "call-1",
            function: {
              name: "read_file",
              arguments: { path: "src/index.ts" },
            },
          },
        ],
      },
      eval_count: 9,
      done: true,
    }),
  ];
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(init.body).stream, true);
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks)
            controller.enqueue(encoder.encode(`${chunk}\n`));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "application/x-ndjson" } },
    );
  };
  const reply = await service.remoteReply(
    {
      chatId: "chat",
      engine: "ollama",
      model: "qwen3:latest",
      executable: "",
      messages: [],
      editMode: "auto",
      contextLimit: 8192,
      hardware: "auto",
      contextSummary: "",
      fileAccess: true,
      webAccess: false,
      browserAccess: false,
      computerAccess: false,
      resumePermission: false,
      goal: "",
    },
    [{ role: "user", content: "Inspect src/index.ts" }],
    service.tools("auto", true, false, false, false),
  );
  assert.equal(reply.thinking, "Inspect the project.");
  assert.equal(reply.content, "I found the next step.");
  assert.deepEqual(reply.toolCalls, [
    {
      id: "call-1",
      name: "read_file",
      arguments: { path: "src/index.ts" },
    },
  ]);
  assert.ok(
    statuses.some((value) => /Reasoning locally.*4 output tokens/.test(value)),
  );
  assert.ok(statuses.some((value) => /Answering/.test(value)));
});

test("permissions and autonomous execution are identical across local engines", async (t) => {
  for (const engine of ["llamacpp", "mlx", "pytorch", "ollama"]) {
    const { root, base, service, chat } = await fixture();
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    let turn = 0;
    service.remoteReply = async () => {
      turn += 1;
      if (turn === 1)
        return {
          content: "I need permission to write project files.",
          toolCalls: [],
        };
      if (turn === 2)
        return {
          content: "I should create and test the requested file now.",
          toolCalls: [],
        };
      if (turn === 3)
        return {
          content: `<tool_call>{"name":"write_file","arguments":{"path":"src/${engine}.ts","content":"export const engine = '${engine}';\\n"}}</tool_call>`,
          toolCalls: [],
        };
      return { content: `Completed with ${engine}.`, toolCalls: [] };
    };
    const result = await service.chat({
      chatId: chat.id,
      engine,
      model: engine === "llamacpp" ? "fixture.gguf" : `fixture-${engine}`,
      executable: "",
      editMode: "auto",
      contextLimit: 8192,
      hardware: "auto",
      contextSummary: "",
      goal: "",
      fileAccess: true,
      webAccess: false,
      browserAccess: false,
      computerAccess: false,
      messages: [
        {
          role: "user",
          content: `Create and verify a project file demonstrating the ${engine} engine integration`,
        },
      ],
    });
    assert.equal(turn, 4, `${engine} should receive both correction turns`);
    assert.deepEqual(result.changedFiles, [`src/${engine}.ts`]);
    assert.ok(result.actions.some((action) => action.tool === "set_goal"));
    assert.ok(result.actions.some((action) => action.tool === "list_files"));
    assert.ok(result.actions.some((action) => action.tool === "write_file"));
    assert.match(
      await fs.readFile(path.join(root, "src", `${engine}.ts`), "utf8"),
      new RegExp(engine),
    );
  }
});

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

test("JSON project files accept structured content from local model tool calls", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const changed = new Set();
  const content = {
    private: true,
    scripts: { build: "vite build" },
  };
  const result = await service.runTool(
    {
      name: "write_file",
      arguments: { path: "package.json", content },
    },
    true,
    changed,
    [],
    true,
    false,
    chat.id,
    false,
    false,
  );
  assert.equal(result, "Saved package.json");
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")),
    content,
  );
});

test("agent action history survives chat persistence", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const createdAt = new Date().toISOString();
  await service.saveChat(
    chat.id,
    [
      { role: "user", content: "Check the docs" },
      {
        role: "assistant",
        content: "Checked.",
        actions: [
          {
            id: "web-1",
            chatId: chat.id,
            kind: "web",
            status: "completed",
            title: "Searched the public web",
            query: "public documentation",
            websites: ["https://example.com/docs"],
            createdAt,
            completedAt: createdAt,
          },
        ],
      },
    ],
    "",
  );
  const state = await service.getAgentState();
  assert.equal(
    state.chats[0].messages[1].actions[0].query,
    "public documentation",
  );
  assert.deepEqual(state.chats[0].messages[1].actions[0].websites, [
    "https://example.com/docs",
  ]);
});

test("successful tool results tell small models to stop repeating actions", () => {
  const saved = toolResultForModel("write_file", "Saved src/index.ts");
  assert.match(saved, /Do not rewrite it again/);
  assert.match(saved, /verification next/);

  const browser = toolResultForModel(
    "browser_open",
    "Opened file:///project/index.html in the dedicated agent browser",
  );
  assert.match(browser, /already open in the Agent Browser/);
  assert.match(browser, /Do not call browser_open again/);
  assert.match(browser, /browser_inspect/);

  const emptyBrowser = toolResultForModel(
    "browser_inspect",
    JSON.stringify({ title: "Preview", text: "", controls: [] }),
  );
  assert.match(emptyBrowser, /rendered no visible content/);
  assert.match(emptyBrowser, /background=true/);

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

test("the agent asks before running global development commands", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await assert.rejects(
    service.runTool(
      {
        name: "run_command",
        arguments: { command: "node", args: ["--version"] },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
    (error) => {
      assert.equal(error.message, "Permission required");
      assert.equal(error.kind, "terminal.run");
      assert.equal(error.detail, "node --version");
      return true;
    },
  );
  await service.grantPermission(
    "terminal.run",
    "conversation",
    chat.id,
    "node --version",
  );
  const result = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: {
          command: "node",
          args: ["--version"],
          purpose: "Check the global Node installation",
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^v\d+/);
  const locator = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: {
          command: process.platform === "win32" ? "where" : "which",
          args: ["node"],
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
  );
  assert.equal(locator.exitCode, 0);
  assert.match(locator.stdout.toLowerCase(), /node/);
  await assert.rejects(
    service.runTool(
      {
        name: "run_command",
        arguments: { command: "node", args: ["--help"] },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "ask",
    ),
    (error) => {
      assert.equal(error.kind, "terminal.run");
      assert.equal(error.detail, "node --help");
      return true;
    },
  );
});

test("package installers always use their separate exact permission unless Always was granted", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  assert.equal(isPackageInstallCommand("npm", ["install", "react"]), true);
  assert.equal(
    isPackageInstallCommand("python", ["-m", "pip", "install", "ruff"]),
    true,
  );
  assert.equal(isPackageInstallCommand("brew", ["install", "node"]), true);
  assert.equal(isPackageInstallCommand("npm", ["run", "build"]), false);

  const npmLocator = spawnSync(
    process.platform === "win32" ? "where.exe" : "which",
    ["npm"],
    { stdio: "ignore" },
  );
  if (npmLocator.status !== 0) {
    t.skip("npm is not installed on this build host");
    return;
  }

  await service.grantPermission(
    "packages.install",
    "conversation",
    chat.id,
    "npm install --help",
  );
  await assert.rejects(
    service.runTool(
      {
        name: "run_command",
        arguments: { command: "npm", args: ["install", "--help"] },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "auto",
    ),
    (error) => {
      assert.equal(error.kind, "packages.install");
      assert.equal(error.detail, "npm install --help");
      return true;
    },
  );

  await service.grantPermission(
    "packages.install",
    "always",
    chat.id,
    "npm install --help",
  );
  const result = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: { command: "npm", args: ["install", "--help"] },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "auto",
    ),
  );
  assert.equal(result.exitCode, 0);
});

test("dedicated Python package tool uses the app-managed environment installer", async (t) => {
  const requested = [];
  const { base, service, chat } = await fixture({
    installPythonPackages: async (packages) => {
      requested.push(packages);
      return {
        packages,
        output: "installed",
        interpreter: "/app-data/project-environment/bin/python",
        createdEnvironment: true,
      };
    },
  });
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, { recursive: true, force: true });
  });
  assert.ok(
    service
      .tools("auto", true, false, false, false)
      .some((item) => item.function.name === "python_install_packages"),
  );
  await service.grantPermission(
    "packages.install",
    "always",
    chat.id,
    "Python packages",
  );
  const result = JSON.parse(
    await service.runTool(
      {
        name: "python_install_packages",
        arguments: {
          packages: ["ultralytics", "opencv-python", "numpy"],
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
      false,
      false,
      "auto",
    ),
  );
  assert.deepEqual(requested, [["ultralytics", "opencv-python", "numpy"]]);
  assert.equal(result.createdEnvironment, true);
  assert.match(result.interpreter, /app-data\/project-environment/);
});

test("background project commands wait for localhost before browser testing", async (t) => {
  const { base, service, chat } = await fixture();
  t.after(async () => {
    await service.dispose();
    await fs.rm(base, {
      recursive: true,
      force: true,
      maxRetries: process.platform === "win32" ? 5 : 0,
      retryDelay: 200,
    });
  });
  const reservation = net.createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => reservation.close(resolve));
  const url = `http://127.0.0.1:${port}/`;
  await service.grantPermission(
    "terminal.run",
    "conversation",
    chat.id,
    "start preview",
  );
  const result = JSON.parse(
    await service.runTool(
      {
        name: "run_command",
        arguments: {
          command: "node",
          args: [
            "-e",
            `require('node:http').createServer((_q,r)=>r.end('ready')).listen(${port},'127.0.0.1')`,
          ],
          background: true,
          ready_url: url,
          purpose: "Start the test preview",
        },
      },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
  );
  assert.equal(result.background, true);
  assert.equal(result.url, url);
  assert.equal(await fetch(url).then((response) => response.text()), "ready");
});

test("missing project files return exact nearby paths", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "src", "App.jsx"), "export default 1;\n");
  await assert.rejects(
    service.runTool(
      { name: "read_file", arguments: { path: "src/App.js" } },
      "auto",
      new Set(),
      [],
      true,
      false,
      chat.id,
    ),
    /src\/App\.jsx/,
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

test("confirmed build requests start a goal, inspect the project, and correct plan-only replies", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turn = 0;
  service.remoteReply = async (_request, messages) => {
    if (turn++ === 0) {
      assert.ok(
        messages.some(
          (message) =>
            message.role === "tool" &&
            message.tool_name === "list_files" &&
            /src\/index\.ts/.test(message.content),
        ),
      );
      return {
        content:
          "I should create the React notes structure and implement the editor.",
        toolCalls: [],
      };
    }
    if (turn === 2)
      return {
        content:
          '<tool_call><function=write_file><parameter=path>src/App.jsx</parameter><parameter=content>export default function App() { return "Notes"; }\n</parameter></function></tool_call>',
        toolCalls: [],
      };
    return { content: "Created the notes editor.", toolCalls: [] };
  };
  const request =
    "Create a local React notes app that stores names and verify the finished project";
  const result = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      { role: "user", content: request },
      { role: "assistant", content: "Should I create it?" },
      { role: "user", content: "yes do that pls" },
    ],
  });
  assert.deepEqual(result.changedFiles, ["src/App.jsx"]);
  assert.ok(result.actions.some((action) => action.tool === "set_goal"));
  assert.ok(result.actions.some((action) => action.tool === "list_files"));
  assert.ok(result.actions.some((action) => action.tool === "write_file"));
  assert.match(
    await fs.readFile(path.join(root, "src", "App.jsx"), "utf8"),
    /Notes/,
  );
});

test("granted edit buttons correct stale model permission prose and continue to the write tool", async (t) => {
  const { root, base, service, chat } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  let turn = 0;
  const modelMessages = [];
  service.remoteReply = async (_request, messages) => {
    modelMessages.push(messages);
    if (turn++ === 0)
      return {
        content: "First, I need permission to write files.",
        toolCalls: [],
      };
    if (turn === 2)
      return {
        content:
          "<tool_call><function=write_file><parameter=path>src/generated.ts</parameter><parameter=content>export const allowed = true;\n</parameter></function></tool_call>",
        toolCalls: [],
      };
    return { content: "Created src/generated.ts.", toolCalls: [] };
  };
  const result = await service.chat({
    chatId: chat.id,
    engine: "mlx",
    model: "fixture-mlx",
    executable: "",
    editMode: "auto",
    contextLimit: 8192,
    contextSummary: "",
    goal: "",
    fileAccess: true,
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
    messages: [
      { role: "assistant", content: "I need permission to write files." },
      { role: "user", content: "Create src/generated.ts now" },
    ],
  });
  assert.deepEqual(result.changedFiles, ["src/generated.ts"]);
  assert.match(
    await fs.readFile(path.join(root, "src", "generated.ts"), "utf8"),
    /allowed = true/,
  );
  assert.ok(
    modelMessages[0].some(
      (message) =>
        message.role === "assistant" &&
        /permission request was resolved/i.test(message.content),
    ),
  );
  assert.ok(
    modelMessages[1].some(
      (message) =>
        message.role === "system" &&
        /visible capability buttons already granted/i.test(message.content),
    ),
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
  const available = (await service.listModels()).find(
    (item) => item.tier === "small",
  );
  assert.ok(available);
  const tierRoot =
    available.engine === "mlx"
      ? path.join(root, "models", "mlx", "osCode-MLX-Small-Q5")
      : path.join(root, "models", "gguf", "small");
  const variant = modelVariants.find(
    (item) => item.tier === "small" && item.runtime === available.engine,
  );
  assert.ok(variant);
  await fs.mkdir(tierRoot, { recursive: true });
  const files = filesForVariant(variant);
  const shards = files
    .map((file) => path.basename(file))
    .filter((file) => file.endsWith(".safetensors"));
  for (const file of files) {
    const name = path.basename(file);
    const content =
      name === "model.safetensors.index.json"
        ? JSON.stringify({
            weight_map: Object.fromEntries(
              shards.map((shard, index) => [`weight.${index}`, shard]),
            ),
          })
        : "test model";
    await fs.writeFile(path.join(tierRoot, name), content);
  }
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
