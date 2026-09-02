import { TouchBar, type BrowserWindow } from "electron";

const accent = "#89cff0";
const dark = "#24292c";
const danger = "#d76b7a";

type OsCodeTouchBarState = {
  editable: boolean;
  dirty: boolean;
  canRun: boolean;
  running: boolean;
  terminalOpen: boolean;
  aiOpen: boolean;
};

export type TouchBarController = {
  update(rawState: unknown): void;
  dispose(): void;
};

function booleanValue(source: Record<string, unknown>, key: string) {
  return source[key] === true;
}

export function installOsCodeTouchBar(
  window: BrowserWindow,
): TouchBarController | null {
  if (process.platform !== "darwin") return null;

  let state: OsCodeTouchBarState = {
    editable: false,
    dirty: false,
    canRun: false,
    running: false,
    terminalOpen: false,
    aiOpen: false,
  };
  const send = (action: string) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send("menu:action", action);
  };
  const undo = new TouchBar.TouchBarButton({
    label: "↶ Undo",
    accessibilityLabel: "Undo editor change",
    backgroundColor: dark,
    click: () => send("editor-undo"),
  });
  const redo = new TouchBar.TouchBarButton({
    label: "↷ Redo",
    accessibilityLabel: "Redo editor change",
    backgroundColor: dark,
    click: () => send("editor-redo"),
  });
  const save = new TouchBar.TouchBarButton({
    label: "Save",
    accessibilityLabel: "Save the current file",
    backgroundColor: dark,
    click: () => send("save"),
  });
  const runStop = new TouchBar.TouchBarButton({
    label: "▶ Run",
    accessibilityLabel: "Run the current Python file",
    backgroundColor: accent,
    click: () => send(state.running ? "stop" : "run"),
  });
  const terminal = new TouchBar.TouchBarButton({
    label: "Terminal",
    accessibilityLabel: "Show or hide the terminal",
    backgroundColor: dark,
    click: () => send("toggle-terminal"),
  });
  const ai = new TouchBar.TouchBarButton({
    label: "AI Chat",
    accessibilityLabel: "Show or hide AI Chat",
    backgroundColor: dark,
    click: () => send("toggle-ai"),
  });
  const bar = new TouchBar({
    items: [
      undo,
      redo,
      new TouchBar.TouchBarSpacer({ size: "small" }),
      save,
      runStop,
      new TouchBar.TouchBarSpacer({ size: "flexible" }),
      terminal,
      ai,
    ],
  });
  window.setTouchBar(bar);

  const render = () => {
    undo.enabled = state.editable;
    redo.enabled = state.editable;
    save.enabled = state.editable;
    save.backgroundColor = state.dirty ? accent : dark;
    runStop.enabled = state.running || state.canRun;
    runStop.label = state.running ? "■ Stop" : "▶ Run";
    runStop.accessibilityLabel = state.running
      ? "Stop the running Python process"
      : "Run the current Python file";
    runStop.backgroundColor = state.running ? danger : accent;
    terminal.backgroundColor = state.terminalOpen ? accent : dark;
    ai.backgroundColor = state.aiOpen ? accent : dark;
  };
  render();

  return {
    update(rawState) {
      if (!rawState || typeof rawState !== "object") return;
      const source = rawState as Record<string, unknown>;
      state = {
        editable: booleanValue(source, "editable"),
        dirty: booleanValue(source, "dirty"),
        canRun: booleanValue(source, "canRun"),
        running: booleanValue(source, "running"),
        terminalOpen: booleanValue(source, "terminalOpen"),
        aiOpen: booleanValue(source, "aiOpen"),
      };
      render();
    },
    dispose() {
      if (!window.isDestroyed()) window.setTouchBar(null);
    },
  };
}
