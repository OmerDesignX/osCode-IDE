import assert from "node:assert/strict";
import test from "node:test";
import {
  actionForTool,
  finishToolAction,
  parseLocalToolCall,
  parseLocalToolCalls,
  parseQwenContent,
  qwenToolInstructions,
  normalizeRunCommand,
  validateGoalEvidence,
  automaticGoalText,
  isCasualGreeting,
  isDeferredActionReply,
  isStalePermissionReply,
  needsTextToolProtocol,
  shouldCreateAutomaticGoal,
  workRequestForAgent,
} from "../dist-electron/main/ai.js";

test("agent action records retain public sources without recording typed text", () => {
  const search = actionForTool(
    {
      id: "search-1",
      name: "web_search",
      arguments: { query: "Electron macOS accessibility documentation" },
    },
    "chat-1",
  );
  const finished = finishToolAction(
    search,
    "completed",
    "Electron https://www.electronjs.org/docs/latest/ and Apple https://developer.apple.com/documentation/applicationservices",
  );
  assert.equal(finished.query, "Electron macOS accessibility documentation");
  assert.deepEqual(finished.websites, [
    "https://www.electronjs.org/docs/latest/",
    "https://developer.apple.com/documentation/applicationservices",
  ]);

  const secret = "never-record-this-value";
  const browserType = actionForTool(
    {
      name: "browser_type",
      arguments: { query: "Search field", text: secret },
    },
    "chat-1",
  );
  const computerType = actionForTool(
    {
      name: "computer_type",
      arguments: { target: "osCode", query: "Prompt", text: secret },
    },
    "chat-1",
  );
  assert.doesNotMatch(JSON.stringify(browserType), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(computerType), new RegExp(secret));
  assert.match(browserType.detail, /23 characters \(text not recorded\)/);

  const page = actionForTool(
    {
      name: "web_fetch",
      arguments: {
        url: "https://person:secret@example.com/docs?token=private#account",
      },
    },
    "chat-1",
  );
  assert.equal(page.url, "https://example.com/docs");
  assert.doesNotMatch(JSON.stringify(page), /secret|private|person/);
});

test("separates Qwen thinking from the formatted final answer", () => {
  assert.deepEqual(
    parseQwenContent(
      "<think>Inspect the project first.</think>\n\n## Result\n\n- Fixed it<|im_end|>",
    ),
    {
      thinking: "Inspect the project first.",
      content: "## Result\n\n- Fixed it",
    },
  );
});

test("supports Qwen thinking models that emit only a closing marker", () => {
  assert.deepEqual(parseQwenContent("Check the files.\n</think>\n\nDone."), {
    thinking: "Check the files.",
    content: "Done.",
  });
});

test("removes a stray punctuation line before a Qwen final answer", () => {
  assert.deepEqual(parseQwenContent(".\n## Result\n\nDone."), {
    content: "## Result\n\nDone.",
    thinking: undefined,
  });
});

test("removes llama.cpp cache diagnostics from public answers", () => {
  assert.deepEqual(
    parseQwenContent(
      "Hello! What would you like to build?\n\nllama_completion: saving final output to\nsession file\n'C:\\\\Users\\\\person\\\\AppData\\\\Roaming\\\\oscode\\\\ai\\\\prompt-cache\\\\abc.bin'",
    ),
    {
      content: "Hello! What would you like to build?",
      thinking: undefined,
    },
  );
});

test("normalizes a safe command accidentally placed in the executable field", () => {
  assert.deepEqual(
    normalizeRunCommand("python -m unittest test_focusboard", [
      "test_focusboard",
    ]),
    {
      command: "python",
      args: ["-m", "unittest", "test_focusboard"],
    },
  );
  assert.throws(
    () => normalizeRunCommand("python & whoami", []),
    /executable name/,
  );
});

test("requires distinct CRUD evidence and an update implementation", () => {
  assert.throws(
    () =>
      validateGoalEvidence(
        "Ship task CRUD",
        ["addTask creates", "render reads", "deleteTask removes"],
        "function addTask() {} function render() {} function deleteTask() {}",
      ),
    /update\/edit/,
  );
  assert.doesNotThrow(() =>
    validateGoalEvidence(
      "Ship task CRUD",
      [
        "addTask creates",
        "render reads",
        "editTask updates",
        "deleteTask removes",
      ],
      "function addTask() {} function render() {} function editTask() {} button.onclick = () => editTask(1); function deleteTask() {}",
    ),
  );
});

test("creates bounded automatic goals only for substantive work", () => {
  assert.equal(shouldCreateAutomaticGoal("Hello"), false);
  assert.equal(
    shouldCreateAutomaticGoal(
      "Create a local React notes app and test that it works",
    ),
    true,
  );
  const request = `Please repair and verify this project. ${"Inspect every requirement. ".repeat(8)}`;
  assert.equal(shouldCreateAutomaticGoal(request), true);
  assert.match(automaticGoalText(request), /^Complete and verify/);
  assert.ok(automaticGoalText(request).length <= 740);
});

test("short confirmations retain the earlier work request and reject plan-only replies", () => {
  const request =
    "Create a local React notes app that stores names and verify the finished project";
  assert.equal(
    workRequestForAgent([
      { role: "user", content: request },
      { role: "assistant", content: "Should I build it?" },
      { role: "user", content: "yes do that pls" },
    ]),
    request,
  );
  assert.equal(
    isDeferredActionReply(
      "I should create the React structure and implement the editor.",
    ),
    true,
  );
  assert.equal(
    isDeferredActionReply("Created and tested the React editor."),
    false,
  );
});

test("recognizes casual greetings without treating work requests as small talk", () => {
  assert.equal(isCasualGreeting("Hi there!"), true);
  assert.equal(isCasualGreeting("Good morning"), true);
  assert.equal(isCasualGreeting("Hi, please fix the tests"), false);
});

test("recognizes obsolete permission prose only when the capability is granted", () => {
  const granted = {
    fileAccess: true,
    editMode: "auto",
    webAccess: false,
    browserAccess: false,
    computerAccess: false,
  };
  assert.equal(
    isStalePermissionReply("First, I need permission to write files.", granted),
    true,
  );
  assert.equal(
    isStalePermissionReply("I need permission to write files.", {
      ...granted,
      fileAccess: false,
    }),
    false,
  );
  assert.equal(
    isStalePermissionReply("The requested file is ready.", granted),
    false,
  );
});

test("parses Qwen coder native tool calls including JSON arrays", () => {
  assert.deepEqual(
    parseLocalToolCall(`<tool_call>
<function=run_command>
<parameter=command>python</parameter>
<parameter=args>["-m", "unittest"]</parameter>
<parameter=purpose>Run the tests</parameter>
</function>
</tool_call>`),
    {
      name: "run_command",
      arguments: {
        command: "python",
        args: ["-m", "unittest"],
        purpose: "Run the tests",
      },
    },
  );
});

test("parses JSON tool calls emitted by the MLX chat template", () => {
  assert.deepEqual(
    parseLocalToolCall(`<tool_call>
{"name":"write_file","arguments":{"path":"src/app.ts","content":"export const ready = true;\\n"}}
</tool_call>`),
    {
      name: "write_file",
      arguments: {
        path: "src/app.ts",
        content: "export const ready = true;\n",
      },
    },
  );
});

test("accepts a recoverable Qwen tool block when outer tags are omitted", () => {
  assert.deepEqual(
    parseLocalToolCall(`<function=read_file>
<parameter=path>src/app.ts</parameter>
</function>`),
    { name: "read_file", arguments: { path: "src/app.ts" } },
  );
});

test("recovers batched Qwen reads with omitted parameter closing tags", () => {
  assert.deepEqual(
    parseLocalToolCalls(`<tool_call>
<function=read_file>
<parameter=path>
app.js
</function>
</tool_call>
<tool_call>
<function=read_file>
<parameter=path>
test_focusboard.py
</parameter>
</function>
</tool_call>`),
    [
      { name: "read_file", arguments: { path: "app.js" } },
      { name: "read_file", arguments: { path: "test_focusboard.py" } },
    ],
  );
});

test("renders the compact Qwen tool protocol expected by the local model", () => {
  const prompt = qwenToolInstructions([
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Write a file",
        parameters: {
          type: "object",
          required: ["path", "content"],
          properties: { path: { type: "string" }, content: { type: "string" } },
        },
      },
    },
  ]);
  assert.match(prompt, /<tools>/);
  assert.match(prompt, /<function=tool_name>/);
  assert.match(prompt, /write_file/);
});

test("MLX and Ollama use their native tool templates without duplicating the text catalogue", () => {
  assert.equal(needsTextToolProtocol("mlx"), false);
  assert.equal(needsTextToolProtocol("ollama"), false);
  assert.equal(needsTextToolProtocol("llamacpp"), true);
  assert.equal(needsTextToolProtocol("pytorch"), true);
});

test("shows Qwen the split command and args form", () => {
  const prompt = qwenToolInstructions([
    {
      type: "function",
      function: {
        name: "run_command",
        description: "Run a command",
        parameters: { type: "object", properties: {} },
      },
    },
  ]);
  assert.match(prompt, /command is "python"/);
  assert.match(prompt, /args is \["-m", "unittest"\]/);
});
