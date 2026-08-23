import assert from "node:assert/strict";
import test from "node:test";
import {
  parseLocalToolCall,
  parseLocalToolCalls,
  parseQwenContent,
  qwenToolInstructions,
  normalizeRunCommand,
  validateGoalEvidence,
  automaticGoalText,
  isCasualGreeting,
  shouldCreateAutomaticGoal,
} from "../dist-electron/main/ai.js";

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
  const request = `Please repair and verify this project. ${"Inspect every requirement. ".repeat(8)}`;
  assert.equal(shouldCreateAutomaticGoal(request), true);
  assert.match(automaticGoalText(request), /^Complete and verify/);
  assert.ok(automaticGoalText(request).length <= 740);
});

test("recognizes casual greetings without treating work requests as small talk", () => {
  assert.equal(isCasualGreeting("Hi there!"), true);
  assert.equal(isCasualGreeting("Good morning"), true);
  assert.equal(isCasualGreeting("Hi, please fix the tests"), false);
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
