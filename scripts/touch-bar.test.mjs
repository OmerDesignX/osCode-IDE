import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("osCode exposes native contextual Touch Bar editor controls", () => {
  const touchBar = read("electron/main/touch-bar.ts");
  const main = read("electron/main/index.ts");
  const preload = read("electron/preload/index.cts");
  const app = read("src/App.tsx");

  assert.match(touchBar, /process\.platform !== "darwin"/);
  assert.match(touchBar, /new TouchBar\(/);
  for (const label of ["Undo", "Redo", "Save", "Run", "Terminal", "AI Chat"])
    assert.match(touchBar, new RegExp(label));
  assert.match(touchBar, /state\.running \? "stop" : "run"/);
  assert.match(touchBar, /nativeImage\.createFromNamedImage/);
  assert.match(touchBar, /NSTouchBarTextBoxTemplate/);
  assert.match(touchBar, /new TouchBar\.TouchBarScrubber/);
  assert.match(touchBar, /mode: "free"/);
  assert.match(touchBar, /showArrowButtons: true/);
  assert.match(touchBar, /select: \(index\)/);
  assert.match(touchBar, /items: \[actionStrip\]/);
  assert.match(touchBar, /actionStrip\.items = actions\.map/);
  for (const action of ["find", "toggle-sidebar", "open-settings"])
    assert.match(touchBar, new RegExp(`action: "${action}"`));
  assert.match(main, /installOsCodeTouchBar\(window\)/);
  assert.match(main, /ipcMain\.handle\("app:set-touch-bar-state"/);
  assert.match(preload, /setTouchBarState:[\s\S]*app:set-touch-bar-state/);
  assert.match(app, /setTouchBarState\(\{/);
  for (const stateKey of ["canRun", "terminalOpen", "aiOpen"])
    assert.match(app, new RegExp(`\\b${stateKey}\\b`));
  assert.match(app, /"editor-undo"/);
  assert.match(app, /"editor-redo"/);
  assert.match(app, /run: \(\) => void run\(\)/);
  assert.match(app, /stop: stopPythonProcess/);
});
