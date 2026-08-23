import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const app = await fs.readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const ai = await fs.readFile(
  new URL("../src/components/AiPanel.tsx", import.meta.url),
  "utf8",
);
const styles = await fs.readFile(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const terminal = await fs.readFile(
  new URL("../src/components/TerminalPanel.tsx", import.meta.url),
  "utf8",
);
const agentControl = await fs.readFile(
  new URL("../electron/main/agent-control.ts", import.meta.url),
  "utf8",
);
const main = await fs.readFile(
  new URL("../electron/main/index.ts", import.meta.url),
  "utf8",
);
const aiMain = await fs.readFile(
  new URL("../electron/main/ai.ts", import.meta.url),
  "utf8",
);

test("compare opens a two-file picker and renders distinct file models", () => {
  assert.match(app, /aria-label="Compare two files"/);
  assert.match(app, /First file/);
  assert.match(app, /Second file/);
  assert.match(app, /originalPath=\{comparison\.leftPath\}/);
  assert.match(app, /modifiedPath=\{comparison\.rightPath\}/);
});

test("permission continuation does not create a synthetic user message", () => {
  assert.doesNotMatch(
    ai,
    /Continue the previous request\. Permission was granted/,
  );
  assert.match(ai, /permissionContinuation\.current/);
  assert.match(ai, /scope === "once" \? "conversation" : scope/);
});

test("AI defaults to Small, bundled context maximum, and custom 8k", () => {
  assert.match(ai, /function preferredTier[\s\S]*return "small"/);
  assert.match(ai, /osCodeGgufTier\(model\)[\s\S]*262_144/);
  assert.match(ai, /model\.preferredContext \|\| 8_192/);
  assert.match(app, /aiVisible && preferencesReady/);
});

test("model downloads, inference hardware, visible capabilities, and spellcheck stay discoverable", () => {
  assert.match(ai, /downloadOsCodeModel\(tier\)/);
  assert.match(ai, />Inference hardware</);
  assert.match(ai, />Files</);
  assert.match(ai, />Edits</);
  assert.match(ai, />Browser</);
  assert.match(ai, />Control</);
  assert.match(app, /Spellcheck/);
  assert.match(app, /onSpellcheckReplaceAll/);
  assert.match(main, /Add to dictionary/);
  assert.match(styles, /\.git-commit-tree/);
  assert.match(
    styles,
    /\.git-help-panel \.compact-panel-head[\s\S]*position: sticky/,
  );
});

test("Ollama uses its focused model picker and manual engine choices are not auto-reset", () => {
  assert.match(ai, /aria-label="Add an Ollama model"/);
  assert.match(ai, /placeholder="Search or enter a model name"/);
  assert.match(ai, /Command line only · no desktop app/);
  assert.match(ai, /Download CLI/);
  assert.match(ai, /Pulling…/);
  assert.match(ai, /manualEngine\.current === engine/);
  assert.match(ai, /const nextEngine = event\.target\.value as AiEngine/);
  assert.match(ai, /nextEngine === "ollama".*openAiPopup\("ollama"\)/s);
  assert.doesNotMatch(ai, /onEngine\("ollama"\);\s*openAiPopup\("models"\)/);
  assert.match(ai, /is ready and selected/);
  assert.match(ai, /setSource\(""\);[\s\S]*setOllamaPickerOpen\(false\)/);
  assert.match(main, /ai:install-ollama-cli/);
  assert.doesNotMatch(`${ai}\n${main}`, /OllamaSetup\.exe|Ollama\.dmg/);
});

test("user chat identity is an icon and compact controls cannot wrap labels", () => {
  assert.match(ai, /<FeatherIcon icon="user" size="16" \/>/);
  assert.doesNotMatch(ai, /<i>\{message\.role === "user" \? "Y" : "O"\}<\/i>/);
  assert.match(
    styles,
    /\.ai-permission-row > \.icon-button span[\s\S]*display: none !important/,
  );
  assert.match(styles, /\.shell-tab-strip[\s\S]*flex-wrap: wrap/);
  assert.match(app, /className="terminal-session-actions"/);
  assert.match(
    styles,
    /\.terminal-session-actions \.icon-button,[\s\S]*width: 34px/,
  );
  assert.match(
    styles,
    /Final interaction overrides[\s\S]*\.terminal-tabs\s*\{[\s\S]*min-height: 46px[\s\S]*padding: 6px 8px/,
  );
});

test("Advanced closes with an icon-only control", () => {
  assert.match(app, /icon="x"[\s\S]*label="Close Advanced"/);
  assert.match(
    styles,
    /\.advanced-title \.icon-button span[\s\S]*display: none !important/,
  );
  assert.match(styles, /\.advanced-title > \.icon-button[\s\S]*width: 36px/);
});

test("light mode reaches the terminal canvas and output surfaces", () => {
  assert.match(app, /<TerminalPanel[\s\S]*theme=\{theme\}/);
  assert.match(terminal, /theme === "blue-light"[\s\S]*background: "#ffffff"/);
  assert.match(terminal, /terminal\.current\.options\.theme/);
  assert.match(styles, /--terminal-bg: #ffffff/);
  assert.match(styles, /\.run-console[\s\S]*background: var\(--terminal-bg\)/);
});

test("Monaco keeps its minimap and scrollbar visually separate", () => {
  assert.match(app, /showSlider: "mouseover"/);
  assert.match(app, /verticalScrollbarSize: 10/);
  assert.match(app, /overviewRulerLanes: 0/);
  assert.match(styles, /\.local-editor-host[\s\S]*overflow: hidden/);
});

test("icon-only controls stay centered and the Git help trigger has even padding", () => {
  assert.match(app, /className="git-help-trigger"/);
  assert.match(
    styles,
    /\.app \.git-panel-head > \.git-help-trigger[\s\S]*width: 34px;[\s\S]*height: 34px;[\s\S]*padding: 0;[\s\S]*justify-content: center/,
  );
  assert.match(
    styles,
    /\.icon-button > svg[\s\S]*display: block;[\s\S]*flex: 0 0 auto/,
  );
});

test("AI chat uses a separate neutral canvas and quiet global scrollbars", () => {
  assert.match(styles, /--chat-bg: #0c1214/);
  assert.match(styles, /\.ai-conversation[\s\S]*background: var\(--chat-bg\)/);
  assert.match(
    styles,
    /\.app \*::\-webkit-scrollbar[\s\S]*width: 5px;[\s\S]*height: 5px/,
  );
  assert.match(
    styles,
    /\.app \*::\-webkit-scrollbar-thumb[\s\S]*background: transparent/,
  );
});

test("AI chat shows a steerable queue and can expand to the full window", () => {
  assert.match(ai, /className="ai-queue-stack"/);
  assert.match(ai, />Steer</);
  assert.match(ai, />Delete</);
  assert.match(ai, /prioritizeAiQueue\(item\.id\)/);
  assert.match(ai, /if \(busyRef\.current\) \{[\s\S]*scheduleQueueRun\(250\)/);
  assert.match(
    ai,
    /finally \{[\s\S]*busyRef\.current = false;[\s\S]*scheduleQueueRun\(\)/,
  );
  assert.match(ai, /icon=\{expanded \? "minimize-2" : "maximize-2"\}/);
  assert.match(
    ai,
    /className=\{`ai-panel\$\{expanded \? " expanded" : ""\}`\}/,
  );
  assert.match(
    styles,
    /\.ai-panel\.expanded\s*\{[\s\S]*position: fixed;[\s\S]*inset: 0;/,
  );
  assert.match(
    styles,
    /\.ai-queue-stack article\s*\{[\s\S]*grid-template-columns:/,
  );
});

test("accelerated llama.cpp lets memory fitting choose GPU layers", () => {
  assert.match(
    aiMain,
    /if \(hardware === "cpu"\) inferenceArguments\.push\("--gpu-layers", "0"\)/,
  );
  assert.doesNotMatch(aiMain, /hardware === "cpu" \? "0" : "999"/);
});

test("agent browser and Computer Control stay visible, permissioned, and stoppable", () => {
  for (const label of [
    "Dedicated agent browser:",
    "Computer Control:",
    "Web access:",
    "File access:",
  ])
    assert.match(ai, new RegExp(label));
  assert.match(ai, /event\.key !== "Escape"[\s\S]*stopAgentControl/);
  assert.match(agentControl, /sandbox: true/);
  assert.match(agentControl, /nodeIntegration: false/);
  assert.match(agentControl, /setDevicePermissionHandler\(\(\) => false\)/);
  assert.match(agentControl, /Private network pages are blocked/);
  assert.match(agentControl, /oscode-agent-cursor/);
  assert.match(agentControl, /WINAPP_CLI_TELEMETRY_OPTOUT: "1"/);
  assert.match(agentControl, /computer-control[\\\s\S]*win32-x64/);
  assert.match(agentControl, /blockedNativeTarget/);
  assert.match(agentControl, /foreground pointer/);
  assert.match(agentControl, /darwin-universal/);
  assert.match(agentControl, /browserSnapshot\(\)/);
  assert.match(app, /View browser/);
  assert.match(app, /agentBrowserSnapshot\(\)/);
  assert.match(app, /agentBrowserTabPath/);
  assert.match(app, /setAiFileAccess\(false\)/);
  assert.match(app, /setAiWebAccess\(false\)/);
  assert.match(app, /setAiBrowserAccess\(false\)/);
  assert.match(app, /setAiComputerAccess\(false\)/);
});

test("AI capability controls have readable spacing and explanatory hover text", () => {
  for (const explanation of [
    "read project files",
    "change project files",
    "search public pages",
    "open and test pages",
    "use approved visible apps",
  ])
    assert.match(ai, new RegExp(explanation));
  assert.match(
    styles,
    /Final AI spacing[\s\S]*\.ai-capability-bar\s*\{[\s\S]*grid-template-columns:[\s\S]*padding: 8px 12px 10px/,
  );
  assert.match(
    styles,
    /\.ai-history-title\s*\{[\s\S]*min-height: 66px;[\s\S]*padding: 18px 20px 16px/,
  );
  assert.match(
    styles,
    /Final interaction overrides[\s\S]*\.ai-capability-bar\s*\{[\s\S]*width: 100%;[\s\S]*padding: 7px 12px 9px/,
  );
});

test("Git history exposes safe actions from every commit row", () => {
  for (const action of [
    "Detached checkout",
    "Cherry-pick",
    "Revert commit",
    "New branch here",
    "New tag here",
  ])
    assert.match(app, new RegExp(action));
  for (const action of [
    "branchCreateAt",
    "tagCreateAt",
    "cherryPick",
    "revertCommit",
  ])
    assert.match(main, new RegExp(action));
});

test("global search separates project code from AI chats", () => {
  assert.match(
    app,
    /placeholder=\{[\s\S]*project[\s\S]*"Search code and chats"/,
  );
  assert.match(app, />Code base</);
  assert.match(app, /global-search-divider/);
  assert.match(app, />AI chats</);
  assert.match(ai, /placeholder="Search chats"/);
  assert.match(
    styles,
    /\.topbar\s*\{[^}]*overflow:\s*visible;/s,
    "the top bar must not clip the global search results popover",
  );
  assert.match(
    styles,
    /search always keeps a dedicated slot[\s\S]*\.global-activity\.has-status[\s\S]*grid-template-columns:\s*minmax\(180px, 1fr\) minmax\(190px, 0\.86fr\)/,
  );
  assert.match(main, /globalSearchWithActivityReady/);
});

test("Git commits use a private repository-local fallback without an author dialog", () => {
  assert.doesNotMatch(app, /aria-label="Commit author"/);
  assert.doesNotMatch(app, /Save and commit/);
  assert.match(
    main,
    /ensureLocalGitIdentity[\s\S]*--local[\s\S]*users\.noreply\.local/,
  );
});

test("terminal controls wrap with even icon padding", () => {
  assert.match(terminal, /letterSpacing: 0/);
  assert.match(
    styles,
    /Final interaction overrides[\s\S]*\.terminal-tabs[\s\S]*padding: 6px 8px/,
  );
  assert.match(
    styles,
    /\.terminal-session-actions \.icon-button[\s\S]*width: 34px/,
  );
});

test("application updates use a remembered one-time notification and Settings toggle", () => {
  assert.match(app, /Turn on automatic updates from GitHub\?/);
  assert.match(app, />\s*Keep off\s*</);
  assert.match(app, />\s*Turn on\s*</);
  assert.match(app, /label=\{tr\("Automatic updates"/);
  assert.match(app, /setAppAutoUpdate\(enabled\)/);
  assert.match(main, /autoUpdatePromptAnswered: true/);
  assert.match(main, /process\.env\.OSCODE_SMOKE_TEST === "1"/);
  assert.match(main, /process\.argv\.includes\("smoke-test"\)/);
  assert.match(main, /\.oscode-smoke-test/);
  assert.match(main, /if \(smokeMarkerReady\) unlinkSync\(smokeMarker\)/);
  assert.match(main, /callback\(\{ cancel: !allowDevelopmentRenderer \}\)/);
});
