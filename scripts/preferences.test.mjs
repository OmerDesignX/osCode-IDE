import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  defaultPreferences,
  validPreferences,
} from "../dist-electron/main/preferences.js";

test("accepts versioned local editor preferences", () => {
  const lastProject = path.resolve("example-project");
  assert.deepEqual(
    validPreferences({
      version: 99,
      theme: "blue-dark",
      locale: "ar",
      sidebarSide: "right",
      uiScale: 1.15,
      editorFontSize: 18,
      sidebarWidth: 360,
      gitHeight: 480,
      aiPanelWidth: 410,
      sidebarVisible: false,
      aiVisible: true,
      aiEngine: "ollama",
      aiModel: "qwen3:0.6b",
      aiExecutable: "",
      aiEditMode: "auto",
      aiFileAccess: false,
      aiWebAccess: true,
      aiContextLimit: 16384,
      aiHardware: "gpu",
      suggestions: false,
      wordWrap: true,
      proseWrap: false,
      minimap: true,
      spellcheck: false,
      autoSave: false,
      autoUpdateEnabled: true,
      autoUpdatePromptAnswered: true,
      lastProject,
      telemetry: true,
    }),
    {
      version: 10,
      theme: "blue-dark",
      locale: "ar",
      sidebarSide: "right",
      uiScale: 1.15,
      editorFontSize: 18,
      sidebarWidth: 360,
      gitHeight: 480,
      aiPanelWidth: 410,
      sidebarVisible: false,
      aiVisible: true,
      aiEngine: "ollama",
      aiModel: "qwen3:0.6b",
      aiExecutable: "",
      aiEditMode: "auto",
      aiFileAccess: false,
      aiWebAccess: true,
      aiContextLimit: 16384,
      aiHardware: "gpu",
      suggestions: false,
      wordWrap: true,
      proseWrap: false,
      minimap: true,
      spellcheck: false,
      autoSave: false,
      autoUpdateEnabled: true,
      autoUpdatePromptAnswered: true,
      lastProject,
    },
  );
});

test("keeps application updates off until the one-time choice is answered", () => {
  const fresh = validPreferences({});
  assert.equal(fresh.autoUpdateEnabled, false);
  assert.equal(fresh.autoUpdatePromptAnswered, false);
  const declined = validPreferences({
    autoUpdateEnabled: false,
    autoUpdatePromptAnswered: true,
  });
  assert.equal(declined.autoUpdateEnabled, false);
  assert.equal(declined.autoUpdatePromptAnswered, true);
});

test("migrates the previous light theme and keeps all current theme choices", () => {
  assert.equal(validPreferences({ theme: "light" }).theme, "blue-light");
  assert.equal(validPreferences({ theme: "dark" }).theme, "dark");
  assert.equal(validPreferences({ theme: "blue-dark" }).theme, "blue-dark");
  assert.equal(validPreferences({ theme: "blue-light" }).theme, "blue-light");
});

test("sanitizes malformed preferences and relative project paths", () => {
  assert.deepEqual(validPreferences(null), defaultPreferences);
  assert.deepEqual(
    validPreferences({
      theme: "neon",
      suggestions: "yes",
      wordWrap: 1,
      minimap: null,
      lastProject: "../outside",
    }),
    defaultPreferences,
  );
});
