import {
  TouchBar,
  nativeImage,
  type BrowserWindow,
  type NativeImage,
} from "electron";

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

function touchBarIcon(name: string): NativeImage {
  const source = nativeImage.createFromNamedImage(name);
  if (source.isEmpty()) return source;
  const icon = source.resize({ width: 18, height: 18, quality: "best" });
  icon.setTemplateImage(true);
  return icon;
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
  const icons = {
    undo: touchBarIcon("NSTouchBarRotateLeftTemplate"),
    redo: touchBarIcon("NSTouchBarRotateRightTemplate"),
    save: touchBarIcon("NSTouchBarDownloadTemplate"),
    run: touchBarIcon("NSTouchBarPlayTemplate"),
    stop: touchBarIcon("NSTouchBarRecordStopTemplate"),
    find: touchBarIcon("NSTouchBarSearchTemplate"),
    files: touchBarIcon("NSTouchBarSidebarTemplate"),
    settings: touchBarIcon("NSTouchBarGetInfoTemplate"),
    terminal: touchBarIcon("NSTouchBarQuickLookTemplate"),
    ai: touchBarIcon("NSTouchBarComposeTemplate"),
  };
  const save = new TouchBar.TouchBarButton({
    label: "Save",
    icon: icons.save,
    iconPosition: "left",
    accessibilityLabel: "Save the current file",
    backgroundColor: dark,
    click: () => send("save"),
  });
  const runStop = new TouchBar.TouchBarButton({
    label: "Run",
    icon: icons.run,
    iconPosition: "left",
    accessibilityLabel: "Run the current Python file",
    backgroundColor: accent,
    click: () => send(state.running ? "stop" : "run"),
  });
  const terminal = new TouchBar.TouchBarButton({
    label: "Terminal",
    icon: icons.terminal,
    iconPosition: "left",
    accessibilityLabel: "Show or hide the terminal",
    backgroundColor: dark,
    click: () => send("toggle-terminal"),
  });
  const ai = new TouchBar.TouchBarButton({
    label: "AI Chat",
    icon: icons.ai,
    iconPosition: "left",
    accessibilityLabel: "Show or hide AI Chat",
    backgroundColor: dark,
    click: () => send("toggle-ai"),
  });
  const secondaryActions = [
    { label: "Undo", icon: icons.undo, action: "editor-undo" },
    { label: "Redo", icon: icons.redo, action: "editor-redo" },
    { label: "Find", icon: icons.find, action: "find" },
    { label: "Files", icon: icons.files, action: "toggle-sidebar" },
    { label: "Settings", icon: icons.settings, action: "open-settings" },
  ];
  const secondary = new TouchBar.TouchBarScrubber({
    items: secondaryActions.map(({ label, icon }) => ({ label, icon })),
    mode: "free",
    continuous: false,
    showArrowButtons: true,
    selectedStyle: "background",
    highlight: (index) => {
      const item = secondaryActions[index];
      if (item) send(item.action);
    },
  });
  const bar = new TouchBar({
    items: [
      secondary,
      save,
      runStop,
      new TouchBar.TouchBarSpacer({ size: "flexible" }),
      terminal,
      ai,
    ],
  });
  window.setTouchBar(bar);

  const render = () => {
    save.enabled = state.editable;
    save.backgroundColor = state.dirty ? accent : dark;
    runStop.enabled = state.running || state.canRun;
    runStop.label = state.running ? "Stop" : "Run";
    runStop.icon = state.running ? icons.stop : icons.run;
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
