import {
  TouchBar,
  nativeImage,
  type BrowserWindow,
  type NativeImage,
} from "electron";

type OsCodeTouchBarState = {
  editable: boolean;
  dirty: boolean;
  canRun: boolean;
  running: boolean;
  terminalOpen: boolean;
  aiOpen: boolean;
};

type TouchBarAction = {
  label: string;
  icon: NativeImage;
  action: string;
  enabled: boolean;
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
    terminal: touchBarIcon("NSTouchBarTextBoxTemplate"),
    ai: touchBarIcon("NSTouchBarComposeTemplate"),
  };
  let actions: TouchBarAction[] = [];
  const actionStrip = new TouchBar.TouchBarScrubber({
    items: [],
    mode: "free",
    continuous: false,
    showArrowButtons: true,
    selectedStyle: "background",
    select: (index) => {
      const item = actions[index];
      if (item?.enabled) send(item.action);
    },
    highlight: () => undefined,
  });
  const bar = new TouchBar({
    items: [actionStrip],
  });
  window.setTouchBar(bar);

  const render = () => {
    actions = [
      {
        label: "Undo",
        icon: icons.undo,
        action: "editor-undo",
        enabled: state.editable,
      },
      {
        label: "Redo",
        icon: icons.redo,
        action: "editor-redo",
        enabled: state.editable,
      },
      {
        label: state.dirty ? "Save •" : "Save",
        icon: icons.save,
        action: "save",
        enabled: state.editable,
      },
      {
        label: state.running ? "Stop" : "Run",
        icon: state.running ? icons.stop : icons.run,
        action: state.running ? "stop" : "run",
        enabled: state.running || state.canRun,
      },
      { label: "Find", icon: icons.find, action: "find", enabled: true },
      {
        label: "Files",
        icon: icons.files,
        action: "toggle-sidebar",
        enabled: true,
      },
      {
        label: state.terminalOpen ? "Terminal •" : "Terminal",
        icon: icons.terminal,
        action: "toggle-terminal",
        enabled: true,
      },
      {
        label: state.aiOpen ? "AI Chat •" : "AI Chat",
        icon: icons.ai,
        action: "toggle-ai",
        enabled: true,
      },
      {
        label: "Settings",
        icon: icons.settings,
        action: "open-settings",
        enabled: true,
      },
    ];
    actionStrip.items = actions.map(({ label, icon }) => ({ label, icon }));
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
