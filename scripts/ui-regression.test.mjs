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
const splitEditor = await fs.readFile(
  new URL("../src/LocalSplitEditor.tsx", import.meta.url),
  "utf8",
);
const localEditor = await fs.readFile(
  new URL("../src/LocalEditor.tsx", import.meta.url),
  "utf8",
);
const mcpClient = await fs.readFile(
  new URL("../electron/main/mcp-client.ts", import.meta.url),
  "utf8",
);

test("Git status groups large untracked dependency folders", () => {
  assert.match(main, /--untracked-files=normal/);
  assert.doesNotMatch(main, /--untracked-files=all/);
});

test("compare opens a two-file picker and renders distinct file models", () => {
  assert.match(app, /aria-label="Compare two files"/);
  assert.match(app, /First file/);
  assert.match(app, /Second file/);
  assert.match(app, /originalPath=\{comparison\.leftPath\}/);
  assert.match(app, /modifiedPath=\{comparison\.rightPath\}/);
});

test("split view lets each pane select and edit a different open tab", () => {
  assert.match(app, /splitLeftPath/);
  assert.match(app, /splitRightPath/);
  assert.match(app, /onSelect=\{\(side, path\)/);
  assert.match(
    splitEditor,
    /aria-label=\{`\$\{side === "left" \? "Left" : "Right"\} split tab`\}/,
  );
  assert.match(
    splitEditor,
    /change\.current\(tab\.path, nextModel\.getValue\(\)\)/,
  );
  assert.match(
    splitEditor,
    /split\/\$\{side\}\/\$\{encodeURIComponent\(tab\.path\)\}/,
  );
  assert.match(styles, /\.split-editor-pane > label/);
});

test("external edits, autosave, undo, redo, and encrypted save history stay visible", () => {
  assert.match(main, /watch\(root, \{ recursive: true \}/);
  assert.match(main, /project:file-changed/);
  assert.match(app, /onProjectFileChanged/);
  assert.doesNotMatch(app, /Autosave on/);
  assert.match(app, /editor-command-divider/);
  assert.match(app, /Save history/);
  assert.match(app, /restoreSaveHistory/);
  assert.match(app, /trigger\("toolbar", "undo"/);
  assert.match(app, /trigger\("toolbar", "redo"/);
  assert.match(localEditor, /saveViewState\(\)/);
  assert.match(localEditor, /pushEditOperations/);
  assert.match(localEditor, /isLocalEcho/);
  assert.doesNotMatch(localEditor, /\.setValue\(/);
  assert.match(styles, /\.save-history-dialog/);
});

test("agent paths and development commands are grounded in the open project", () => {
  assert.match(agentControl, /projectFileFromStalePath/);
  assert.match(aiMain, /Use an exact listed path instead/);
  assert.match(aiMain, /localPackageBin/);
  assert.match(aiMain, /host PATH available/);
  assert.match(aiMain, /"npm"/);
  assert.match(aiMain, /"which"/);
  assert.match(aiMain, /"ls"/);
  assert.match(aiMain, /Terminal is set to Ask/);
  assert.doesNotMatch(aiMain, /Never probe for npm, node, yarn, pnpm/);
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

test("app-managed and optional project Python environments are package-ready", () => {
  assert.match(
    main,
    /\["venv", "--python", base\.path, "--seed", destination\]/,
  );
  assert.match(main, /terminalEnv\.VIRTUAL_ENV = parent/);
  assert.match(main, /terminalEnv\.UV_PROJECT_ENVIRONMENT = parent/);
  assert.match(main, /terminalEnv\.UV_CACHE_DIR = uvCacheRoot\(\)/);
  assert.match(main, /"python:install-package"/);
  assert.match(main, /"python:list-packages"/);
  assert.match(main, /"python:uninstall-package"/);
  assert.match(main, /existingProjectPythonEnvironment/);
  assert.match(main, /ensureProjectPythonEnvironment/);
  assert.match(main, /appProjectEnvironmentRoot/);
  assert.match(main, /project-environments/);
  assert.match(
    main,
    /startProjectWatcher[\s\S]*"\.venv"[\s\S]*"__pycache__"/,
    "project environment files must not flood the live editor watcher",
  );
  assert.match(main, /app-managed environment/);
  assert.match(
    main,
    /\["pip", "install", "--python", inspected\.path, \.\.\.packages\]/,
  );
  assert.match(main, /\[\s*"pip",\s*"list",[\s\S]*"--format",\s*"json"/);
  assert.match(main, /\[\s*"pip",\s*"uninstall",[\s\S]*packageName/);
  assert.match(app, /aria-label="Package to install"/);
  assert.match(app, /aria-label="Filter installed Python packages"/);
  assert.match(app, /outside project/);
  assert.match(app, /Create project \.venv/);
  assert.match(app, /Use app environment/);
  assert.match(app, /item\.scope === "app"/);
  assert.match(app, /className="uv-helpbook"/);
  assert.match(app, /Project libraries/);
  assert.match(app, /<b>UV help<\/b>/);
  assert.match(app, /uvHelpEntries/);
  assert.match(app, /installPythonPackage\([\s\S]*runtime,[\s\S]*packageSpec/);
  assert.match(terminal, /\.createTerminal\(id, interpreter\)/);
  assert.match(terminal, /\[id, interpreter\]/);
  assert.match(main, /if \(terminals\.get\(id\) !== terminal\) return/);
  assert.match(
    main,
    /if \(terminals\.get\(id\) === terminal\) \{[\s\S]*terminalOwners\.delete\(id\)/,
  );
});

test("the global toolbar and Python drawers use one balanced padded control system", () => {
  assert.match(app, /global-search-toggle/);
  assert.match(app, /globalSearchOpen/);
  assert.match(styles, /Balanced application chrome/);
  assert.match(
    styles,
    /\.topbar\s*\{[\s\S]*height: 68px;[\s\S]*grid-template-rows: 68px/,
  );
  assert.match(styles, /\.topbar > \.top-actions\s*\{[\s\S]*grid-row: 1/);
  assert.match(
    styles,
    /\.topbar \.top-actions \.icon-button,[\s\S]*height: 42px/,
  );
  assert.match(styles, /\.editor-command-bar button\s*\{[\s\S]*height: 42px/);
  assert.match(styles, /\.terminal-tabs\s*\{[\s\S]*height: 52px/);
  assert.match(
    styles,
    /\.terminal-panel:has\(\.python-help\)\s*\{[\s\S]*flex-basis: clamp\(330px, 44vh, 480px\)/,
  );
  assert.match(styles, /\.python-help\s*\{[\s\S]*position: absolute/);
  assert.match(app, /python-drawer-actions/);
  assert.match(
    app,
    /className="python-package-form"[\s\S]*className="python-package-search"/,
  );
  assert.match(
    styles,
    /\.terminal-workspace > \.uv-helpbook,[\s\S]*position: absolute/,
  );
  assert.match(
    styles,
    /\.python-help > \.python-package-list\s*\{[\s\S]*flex-direction: column/,
  );
  assert.match(styles, /\.python-package-progress/);
  assert.match(styles, /\.terminal-python-tools/);
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

test("browser, Terminal, and Computer Control stay visible and permissioned", () => {
  for (const label of [
    "Dedicated agent browser:",
    "Terminal access:",
    "Computer Control:",
    "Web access:",
    "File access:",
  ])
    assert.match(ai, new RegExp(label));
  assert.match(ai, /terminalMode === "auto"/);
  assert.match(ai, /kind: "terminal\.run"/);
  assert.match(
    ai,
    /Browser<\/span>[\s\S]*Terminal<\/span>[\s\S]*Control<\/span>/,
  );
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
  assert.match(agentControl, /cleanBrowserAddress/);
  assert.match(agentControl, /showBrowser\(\)/);
  assert.match(app, /Agent Browser/);
  assert.match(app, /agentBrowserSnapshot\(\)/);
  assert.match(app, /showAgentBrowser\(\)/);
  assert.match(app, /setInterval\(\(\) => void refresh\(\), 1_000\)/);
  assert.match(app, /agentBrowserTabPath/);
  assert.match(app, /if \(!browserViewOpen\) return/);
  assert.doesNotMatch(
    app,
    /if \(!next\.active\) \{\s*setBrowserViewOpen\(false\)/,
  );
  assert.match(main, /agent:browser-show/);
  assert.match(app, /setAiFileAccess\(false\)/);
  assert.match(app, /setAiWebAccess\(false\)/);
  assert.match(app, /setAiBrowserAccess\(false\)/);
  assert.match(app, /setAiComputerAccess\(false\)/);
});

test("MCP and WebMCP are encrypted, read-only, untrusted, and exactly permissioned", () => {
  assert.match(app, /"mcp", "MCP"/);
  assert.match(app, /listMcpServers/);
  assert.match(app, /encrypted in[\s\S]*app data/i);
  assert.match(aiMain, /mcp_list_tools/);
  assert.match(aiMain, /mcp_call_tool/);
  assert.match(aiMain, /webmcp_list_tools/);
  assert.match(aiMain, /webmcp_call_tool/);
  assert.match(aiMain, /assertSafeExternalPayload/);
  assert.match(aiMain, /"mcp\.call"/);
  assert.match(agentControl, /document\.modelContext/);
  assert.match(agentControl, /readOnlyHint/);
  assert.match(mcpClient, /SecureDataStore/);
  assert.match(mcpClient, /mcp-servers\.oscode-data/);
  assert.match(mcpClient, /readOnlyHint !== true/);
  assert.match(mcpClient, /safeEnvironment/);
  assert.doesNotMatch(mcpClient, /\.\.\.process\.env/);
});

test("final Git, terminal, and PlatformIO controls use matching padded heights", () => {
  assert.match(
    styles,
    /Final control alignment:[\s\S]*\.git-panel-head[\s\S]*min-height: 54px/,
  );
  assert.match(styles, /\.git-panel-head > \.icon-button,[\s\S]*height: 42px/);
  assert.match(
    styles,
    /\.terminal-tabs button,[\s\S]*min-height: 42px;[\s\S]*height: 42px/,
  );
  assert.match(
    styles,
    /\.platformio-version button[\s\S]*width: auto;[\s\S]*min-width: 104px/,
  );
});

test("package installation and localhost previews have dedicated safe flows", () => {
  assert.match(aiMain, /isPackageInstallCommand/);
  assert.match(aiMain, /python_install_packages/);
  assert.match(aiMain, /use python_install_packages for Python dependencies/);
  assert.match(aiMain, /"packages\.install"/);
  assert.match(aiMain, /background=true/);
  assert.match(aiMain, /ready_url/);
  assert.match(aiMain, /previewResponding/);
  assert.match(aiMain, /ERR_CONNECTION_REFUSED/);
  assert.match(ai, /permissionRequest\.kind !== "packages\.install"/);
  assert.match(ai, /Always allow/);
  assert.match(styles, /\.editor-command-bar[\s\S]*overflow-x: auto/);
  assert.match(styles, /\.ai-live-work[\s\S]*flex-direction: column/);
});

test("agent chat yields scroll ownership during work and returns on completion", () => {
  assert.match(ai, /followConversationRef/);
  assert.match(ai, /onWheel=\{\(\) =>/);
  assert.match(ai, /distanceFromBottom < 72/);
  assert.match(ai, /if \(busy && !followConversationRef\.current\) return/);
  assert.match(ai, /!busy && wasBusy \? "smooth" : "auto"/);
  assert.doesNotMatch(ai, /\[messages, status\][\s\S]{0,120}scrollIntoView/);
});

test("PlatformIO agent flow has explicit setup guidance and install approval", () => {
  assert.match(aiMain, /platformio_install/);
  assert.match(aiMain, /PlatformIO is integrated into osCode/);
  assert.match(aiMain, /never create a file or folder named only platformio/);
  assert.match(ai, /"platformio\.install": "Install PlatformIO Core"/);
  assert.match(ai, /oneShotPermissionKinds[\s\S]*"platformio\.install"/);
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
  assert.match(app, /placeholder="Search code and chats"/);
  assert.match(
    app,
    /aria-label=\{globalSearchOpen \? "Close search" : "Open search"\}/,
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
    /Balanced application chrome[\s\S]*\.topbar > \.global-activity,[\s\S]*display: flex !important/,
  );
  assert.match(main, /globalSearchWithActivityReady/);
  assert.match(main, /balancedControlSizing/);
});

test("Git commits use a private repository-local fallback without an author dialog", () => {
  assert.doesNotMatch(app, /aria-label="Commit author"/);
  assert.doesNotMatch(app, /Save and commit/);
  assert.match(
    main,
    /ensureLocalGitIdentity[\s\S]*--local[\s\S]*users\.noreply\.local/,
  );
  assert.match(
    app,
    /!git\.files\.some\([\s\S]*file\.index !== " " && file\.index !== "\?"/,
  );
  assert.match(main, /There are no changes to commit/);
  assert.match(main, /Stage at least one changed file before committing/);
});

test("accent buttons keep dark readable text and macOS narrow panels wrap cleanly", () => {
  assert.doesNotMatch(styles, /accentText/);
  assert.match(
    styles,
    /\.notification-row \.notification-choice button\.primary\s*\{[\s\S]*color: var\(--onaccent\)/,
  );
  assert.match(app, /data-platform=\{window\.oscode\.platform\}/);
  assert.match(
    styles,
    /macOS uses taller native text metrics[\s\S]*\.ai-tier-picker\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /\.app\[data-platform="darwin"\] \.ai-capability-bar\s*\{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
  );
});

test("Apple-silicon MLX repairs its isolated runtime before first inference", () => {
  assert.match(aiMain, /Preparing MLX for first use/);
  assert.match(aiMain, /await this\.prepareEngine\("mlx"\)/);
  assert.match(aiMain, /mlx-lm==0\.31\.3/);
  assert.match(aiMain, /mlx==0\.32\.1/);
  assert.match(aiMain, /macOS 14 or newer/);
  assert.match(ai, /hardware\?\.engine === "mlx"/);
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
  assert.match(app, />\s*Don't show again\s*</);
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

test("application updater exposes manual download, progress, install, and dismissal controls", () => {
  assert.match(app, /downloadAppUpdate/);
  assert.match(app, /installAppUpdate/);
  assert.match(app, /className={`app-update-action/);
  assert.match(app, /Install update/);
  assert.match(app, /Download update/);
  assert.match(app, /Don't show again/);
  assert.match(app, /settings-update-progress/);
  assert.match(app, /autoUpdateDismissedVersion/);
  assert.match(app, /updateReminderDismissed/);
  assert.match(
    app,
    /const showUpdateAction =\s*!updateReminderDismissed &&\s*\["available", "downloading", "ready", "installing"\]\.includes/,
  );
  assert.doesNotMatch(app, /const showUpdateAction =[^;]*!autoUpdateEnabled/s);
  assert.match(styles, /\.app-update-action\.ready/);
  assert.match(styles, /\.settings-update-progress/);
});

test("packaged builds cannot be redirected by an inherited dev-server URL", () => {
  assert.match(
    main,
    /const devUrl = app\.isPackaged \? undefined : process\.env\.VITE_DEV_SERVER_URL/,
  );
  assert.match(
    main,
    /else window\.loadFile\(path\.join\(app\.getAppPath\(\), "dist\/index\.html"\)\)/,
  );
});

test("project windows share one model queue while keeping project chats separate", () => {
  assert.match(main, /new Map<number, WindowContext>/);
  assert.match(main, /id: "file-new-window"/);
  assert.match(main, /label: "New Window"/);
  assert.match(main, /queueAiRequest\(event, request\)/);
  assert.match(main, /const aiPipelineEntries: AiPipelineEntry\[\] = \[\]/);
  assert.match(main, /new AsyncLocalStorage<string>\(\)/);
  assert.match(main, /withSenderAiProject/);
  assert.match(main, /aiProjectContexts\.run\(requestedRoot/);
  assert.match(main, /publishAiPipelineStates\(\)/);
  assert.match(main, /"ai:pipeline-state"/);
  assert.match(main, /state: "waiting"/);
  assert.match(main, /position/);
  assert.match(main, /AI is working in \$\{running\.projectName\}/);
  assert.match(main, /aiExecutionOwner\?\.id === event\.sender\.id/);
  assert.match(main, /Another project is already running Python/);
  assert.match(main, /broadcastToRenderers\("preferences:changed"/);
  assert.match(app, /onPreferencesChanged/);
  assert.match(app, /next\.kind === "queue"/);
});

test("macOS traffic lights have a dedicated row above cross-platform app chrome", () => {
  assert.match(app, /className="mac-titlebar-safe-area"/);
  assert.match(
    styles,
    /\.app\[data-platform="darwin"\] \.mac-titlebar-safe-area\s*\{[\s\S]*height: 30px;[\s\S]*-webkit-app-region: drag/,
  );
  assert.match(styles, /\.mac-titlebar-safe-area\s*\{\s*display: none/);
});

test("model selector collapses after configuration and queued windows get a banner", () => {
  assert.match(ai, /className="ai-tier-toggle"/);
  assert.match(ai, /aria-expanded=\{tierPickerOpen\}/);
  assert.match(ai, /icon=\{tierPickerOpen \? "chevron-up" : "chevron-down"\}/);
  assert.match(ai, /setTierPickerOpen\(!configured\)/);
  assert.match(ai, /setTierPickerOpen\(false\)/);
  assert.match(ai, /pipelineState\.state === "waiting"/);
  assert.match(ai, /className="ai-pipeline-banner"/);
  assert.match(styles, /\.ai-tier-toggle\s*\{/);
  assert.match(styles, /\.ai-pipeline-banner\s*\{/);
});

test("model and permission controls use padded drawers that leave the chat after sending", () => {
  assert.match(ai, /permissionsDrawerOpen/);
  assert.match(ai, /className="ai-capability-toggle"/);
  assert.match(ai, /aria-expanded=\{permissionsDrawerOpen\}/);
  assert.match(ai, /setPermissionsDrawerOpen\(true\)/);
  assert.match(ai, /setPermissionsDrawerOpen\(false\)/);
  assert.match(ai, /className="ai-stop-button"/);
  assert.match(ai, /window\.oscode\.stopAi\(\)/);
  assert.match(
    styles,
    /Final compact drawers[\s\S]*\.ai-tier-toggle\s*\{[\s\S]*min-height: 54px;[\s\S]*padding: 10px 14px/,
  );
  assert.match(styles, /\.ai-capability-drawer\s*\{/);
  assert.match(styles, /\.ai-capability-toggle\s*\{/);
  assert.match(aiMain, /output tokens/);
  assert.match(aiMain, /Reading context/);
  assert.match(aiMain, /__OSCODE_PROGRESS__/);
});

test("agent design and live inference feedback stay cross-platform across every engine", () => {
  assert.doesNotMatch(ai, /window\.oscode\.platform|data-platform=/);
  for (const selector of [
    ".ai-tier-toggle",
    ".ai-capability-drawer",
    ".ai-live-work",
    ".ai-action-timeline",
    ".ai-response-actions",
    ".ai-reasoning",
  ])
    assert.match(styles, new RegExp(`\\${selector}(?:\\s*,|\\s*\\{)`));
  assert.match(aiMain, /request\.engine === "ollama"[\s\S]*ollamaReply/);
  assert.match(aiMain, /stream: true/);
  assert.match(aiMain, /TextIteratorStreamer/);
  assert.match(aiMain, /generated_tokens/);
  assert.match(aiMain, /private async llamaReply/);
  assert.match(aiMain, /private async mlxReply/);
});

test("enabled capability controls create scoped grants and prompt the model authoritatively", () => {
  assert.match(ai, /ensureCapabilityPermissions/);
  assert.match(ai, /applyCapabilities/);
  assert.match(ai, /model updated/);
  assert.match(ai, /"conversation",\s*currentChatId/);
  assert.match(ai, /kind: "project\.read"/);
  assert.match(ai, /kind: "project\.write"/);
  assert.match(aiMain, /CAPABILITY STATE FOR THIS REQUEST/);
  assert.match(aiMain, /Never ask the user for that permission in prose/);
  assert.match(aiMain, /tools=r\.get\('tools',\[\]\)/);
  assert.match(aiMain, /isStalePermissionReply/);
  assert.match(aiMain, /await this\.requirePermission\([\s\S]*"project\.read"/);
});

test("security activity expands into timestamped notifications", () => {
  assert.match(app, /activity\?\.kind === "security"/);
  assert.match(app, /title="Open activity details"/);
  assert.match(app, /setNotificationsOpen\(true\)/);
  assert.match(app, /createdAt: Date\.now\(\)/);
  assert.match(styles, /\.top-status\[role="button"\]/);
});

test("agent work is shown live and retained as a privacy-aware chat timeline", () => {
  assert.match(ai, /label="Agent activity"/);
  assert.match(ai, /aria-label="Agent activity history"/);
  assert.match(ai, /window\.oscode\.onAiAction/);
  assert.match(ai, /Model reasoning notes/);
  assert.match(ai, /Work log/);
  assert.match(ai, /Current step/);
  assert.match(ai, /Typed text and file contents are not/);
  assert.match(ai, /resolveLatestPermissionAction/);
  assert.match(ai, /denied by the user/);
  assert.match(
    ai,
    /remainingLiveActions[\s\S]*action\.id !== resolvedActionId/,
  );
  assert.match(ai, /entry\.websites/);
  assert.match(aiMain, /title: "Searching the public web"/);
  assert.match(aiMain, /text not recorded/);
  assert.match(main, /aiExecutionOwner\.send\("ai:action", action\)/);
  assert.match(styles, /\.ai-activity-popover\s*\{/);
  assert.match(styles, /\.ai-action-timeline\s*\{/);
  assert.match(styles, /\.ai-live-work\s*\{/);
});

test("packaged shutdown is safe when startup or terminal initialization is incomplete", () => {
  assert.match(main, /function disposeAiServiceSafely\(\)/);
  assert.match(main, /aiService\?\.dispose\(\)/);
  assert.match(
    main,
    /let exited: ReturnType<typeof terminal\.onExit> \| undefined/,
  );
  assert.match(main, /exited\?\.dispose\(\)/);
  assert.doesNotMatch(main, /await aiService\.dispose\(\)/);
  assert.doesNotMatch(main, /void aiService\.dispose\(\)/);
});
