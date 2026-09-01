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
const mediaPreview = await fs.readFile(
  new URL("../src/components/MediaPreview.tsx", import.meta.url),
  "utf8",
);
const platformio = await fs.readFile(
  new URL("../src/components/PlatformioPanel.tsx", import.meta.url),
  "utf8",
);
const featherIcon = await fs.readFile(
  new URL("../src/components/FeatherIcon.tsx", import.meta.url),
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
const projectFileOperations = await fs.readFile(
  new URL("../electron/main/project-files.ts", import.meta.url),
  "utf8",
);
const projectPythonDiscovery = await fs.readFile(
  new URL("../electron/main/python-project-environments.ts", import.meta.url),
  "utf8",
);
const aiMain = await fs.readFile(
  new URL("../electron/main/ai.ts", import.meta.url),
  "utf8",
);
const preload = await fs.readFile(
  new URL("../electron/preload/index.cts", import.meta.url),
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
const releaseCleanup = await fs.readFile(
  new URL("../releaseScripts/common/cleanup-release.mjs", import.meta.url),
  "utf8",
);

test("release cleanup safely unlocks generated package directories", () => {
  assert.match(releaseCleanup, /path\.basename\(target\) !== "release"/);
  assert.match(releaseCleanup, /details\.isSymbolicLink\(\)/);
  assert.match(releaseCleanup, /await fs\.chmod\(directory, 0o700\)/);
  assert.match(releaseCleanup, /await makeDirectoriesWritable\(target\)/);
  assert.match(
    releaseCleanup,
    /await fs\.rm\(target, \{ recursive: true, force: true \}\)/,
  );
});

test("AI work survives chat hiding, window hiding, and renderer reattachment", () => {
  assert.doesNotMatch(
    main,
    /window\.on\("closed"[\s\S]{0,900}aiService\.stop\(\)/,
  );
  assert.match(
    main,
    /process\.platform === "darwin"[\s\S]*?event\.preventDefault\(\);[\s\S]*?window\.hide\(\)/,
  );
  assert.match(main, /async function persistAiResponse/);
  assert.match(main, /broadcastToAiProject\([\s\S]*?"ai:chat-complete"/);
  assert.match(main, /ipcMain\.handle\("ai:pipeline-current"/);
  assert.match(preload, /aiPipelineState: \(\) => ipcRenderer\.invoke/);
  assert.match(preload, /onAiChatComplete:/);
  assert.match(ai, /window\.oscode[\s\S]{0,60}\.aiPipelineState\(\)/);
  assert.match(ai, /window\.oscode\.onAiChatComplete/);
  assert.match(ai, /pipelineState\.activeChatId === chatId/);
  assert.match(app, /\{preferencesReady && \(/);
  assert.match(app, /hidden=\{!aiVisible\}/);
  assert.match(app, /visible=\{aiVisible\}/);
  assert.match(ai, /hidden=\{!visible\}/);
});

test("osCode anchors project work to the active editor file without trapping traversal", () => {
  assert.match(
    app,
    /activeFile=\{active && !active\.media \? active\.path : ""\}/,
  );
  assert.match(ai, /const executionChatId = chatIdRef\.current/);
  assert.match(ai, /activeFile: activeFile \|\| ""/);
  assert.match(aiMain, /ACTIVE EDITOR CONTEXT:/);
  assert.match(aiMain, /inspect this exact file first/);
  assert.match(
    aiMain,
    /Use the broader project tree only when the active file is insufficient/,
  );
});

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

test("file and browser tabs use dedicated accessible close buttons", () => {
  assert.match(app, /className="tab-select"/);
  assert.match(app, /className="tab-close"/);
  assert.match(app, /aria-label=\{`Close \$\{t\.name\}`\}/);
  assert.match(
    app,
    /className="tab-close"[\s\S]*onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*void closeTab\(t\.path\);/,
  );
  assert.match(app, /const closing = tabsRef\.current\.find/);
  assert.match(app, /setActivePath\(\(current\) =>/);
  assert.match(app, /aria-label="Close Agent browser tab"/);
  assert.match(
    styles,
    /\.tab-close\s*\{[\s\S]*width: 30px;[\s\S]*height: 30px;/,
  );
  assert.match(styles, /\.tab-close\s*\{[\s\S]*border-radius: 50%;/);
  assert.match(styles, /\.tab-close:hover,[\s\S]*\.tab-close:focus-visible/);
  assert.match(
    styles,
    /A file tab is one interactive pill[\s\S]*\.app \.tab-select,[\s\S]*\.app \.tab-select:hover:not\(:disabled\)[\s\S]*background: transparent !important;[\s\S]*box-shadow: none !important;/,
  );
  assert.match(
    styles,
    /\.app \.tab:hover,[\s\S]*\.app \.tab:focus-within,[\s\S]*\.app \.tab\.active\s*\{[\s\S]*border-radius: var\(--radius-pill\) !important;[\s\S]*background: var\(--control-selected-fill\) !important;/,
  );
  assert.match(
    main,
    /fileTabPillHighlightReady[\s\S]*fileTabPillProbe\.matches\(':focus-within'\)[\s\S]*fileTabSelectStyle\.backgroundColor/,
  );
  assert.match(main, /fileTabCloseHitReady = clickIconCenter/);
  assert.match(main, /result\.fileTabCloseReady !== true/);
  assert.match(main, /result\.fileTabPillHighlightReady !== true/);
});

test("explorer and document tabs expose complete functional file commands", () => {
  for (const channel of [
    "project:duplicate-item",
    "project:choose-directory",
    "project:transfer-item",
    "project:copy-path",
    "project:reveal-item",
    "file:save-as",
  ]) {
    assert.match(
      main,
      new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(projectFileOperations, /assertInside\(root, target\)/);
  assert.match(projectFileOperations, /fs\.cp\(source, destination/);
  assert.match(
    projectFileOperations,
    /await fs\.rename\(source, destination\)/,
  );
  assert.match(
    projectFileOperations,
    /A folder cannot be placed inside itself/,
  );
  assert.match(preload, /duplicateProjectItem:/);
  assert.match(preload, /transferProjectItem:/);
  assert.match(preload, /saveFileAs:/);
  assert.match(app, /className="project-context-menu"/);
  assert.match(app, /showProjectContextMenu\("tree"/);
  assert.match(app, /showProjectContextMenu\([\s\S]*?"tab"/);
  assert.match(app, /Close Editors to the Right/);
  assert.match(app, /Save As…/);
  assert.match(app, /Copy Relative Path/);
  assert.match(main, /label: "Selection"/);
  assert.match(main, /label: "Go"/);
  assert.match(
    styles,
    /\.project-context-menu\s*\{[\s\S]*padding: 8px;[\s\S]*border-radius: 18px;/,
  );
  assert.match(
    styles,
    /\.project-context-menu button[\s\S]*min-height: 38px;[\s\S]*padding: 0 12px;/,
  );
});

test("interactive chrome uses scoped pill and circular control geometry", () => {
  assert.match(styles, /--radius-pill: 999px;/);
  assert.match(styles, /--radius-composer: 26px;/);
  assert.match(
    styles,
    /\.global-search-toggle,[\s\S]*\.tab-close[\s\S]*border-radius: 50%;/,
  );
  assert.match(
    styles,
    /\.ai-composer\s*\{[\s\S]*border-radius: var\(--radius-composer\);/,
  );
  assert.match(
    styles,
    /\.editor-command-bar button,[\s\S]*\.markdown-toolbar button[\s\S]*border-radius: var\(--radius-pill\);/,
  );
});

test("flat pill polish removes accent rails and keeps search chrome responsive", () => {
  assert.match(styles, /Flat pill visual pass/);
  assert.match(
    styles,
    /\.tab\.active::before\s*\{[\s\S]*content: none !important;[\s\S]*display: none !important;/,
  );
  assert.match(
    styles,
    /\.tab,[\s\S]*\.tab\.active\s*\{[\s\S]*border-color: transparent !important;[\s\S]*box-shadow: none !important;/,
  );
  assert.match(
    styles,
    /\.topbar \.global-activity-strip > \.global-search\.expanded\s*\{[\s\S]*min-width: 180px;[\s\S]*flex: 1 1 260px;/,
  );
  assert.match(styles, /--selection-fill:/);
  assert.match(styles, /--focus-neutral:/);
});

test("the final rendered control contract keeps fields, pills, and switches contained", () => {
  const contractStart = styles.lastIndexOf("/* Rendered-control contract");
  const roundedSystemStart = styles.lastIndexOf("/* Rounded control system");
  assert.ok(contractStart > roundedSystemStart);
  const contract = styles.slice(contractStart);

  assert.match(
    contract,
    /input:not\(\[type="checkbox"\]\)[\s\S]*textarea[\s\S]*border: 0 !important;[\s\S]*outline: 0 !important;/,
  );
  assert.match(
    contract,
    /\.topbar \.top-actions \.icon-button\.active\s*\{[\s\S]*border-radius: var\(--radius-pill\) !important;|\.topbar \.top-actions \.icon-button\s*\{[\s\S]*border-radius: var\(--radius-pill\) !important;/,
  );
  assert.match(
    contract,
    /\.notification-row,[\s\S]*border-radius: 20px;[\s\S]*background: var\(--control-hover-fill\);/,
  );
  assert.match(
    contract,
    /\.app \.git-panel-head > \.git-help-trigger,[\s\S]*border-radius: 50% !important;/,
  );
  assert.match(
    contract,
    /\.theme-choice button,[\s\S]*border-radius: var\(--radius-pill\) !important;/,
  );
  assert.match(
    contract,
    /\.settings-select-row select,[\s\S]*padding-inline: 22px 58px !important;[\s\S]*appearance: none;/,
  );
  assert.match(
    contract,
    /\.toggle-row > i\s*\{[\s\S]*overflow: hidden;[\s\S]*width: 48px;|\.toggle-row > i\s*\{[\s\S]*width: 48px;[\s\S]*overflow: hidden;/,
  );
  assert.match(
    contract,
    /\.ai-model-popover \.ai-setting-row\s*\{[\s\S]*min-height: 72px;[\s\S]*gap: 24px;[\s\S]*padding-block: 10px;/,
  );
  assert.match(
    contract,
    /\.ai-thinking-setting\.toggle-row > i\s*\{[\s\S]*width: 46px !important;[\s\S]*height: 26px !important;[\s\S]*overflow: hidden !important;[\s\S]*contain: paint;/,
  );
  assert.match(
    contract,
    /\.ai-thinking-setting\.toggle-row > i::after\s*\{[\s\S]*inset: auto !important;[\s\S]*right: auto !important;[\s\S]*width: 18px !important;[\s\S]*transform: translate3d\(0, 0, 0\) !important;/,
  );
  assert.match(
    contract,
    /Final pill-surface contract[\s\S]*\.global-search::before,[\s\S]*content: none !important/,
    "the search capsule must never regain an inner native frame",
  );
  assert.match(
    contract,
    /The local-agent message bar is one uninterrupted capsule[\s\S]*\.ai-composer,[\s\S]*border-radius: var\(--radius-pill\) !important/,
    "the message composer must render as one pill",
  );
  assert.match(
    contract,
    /Notifications read as separate message pills[\s\S]*\.notification-row:not\(\.update-prompt\)[\s\S]*border-radius: var\(--radius-pill\) !important/,
    "regular notification messages must render as pills",
  );
  assert.match(
    contract,
    /\.tab\.active::before\s*\{[\s\S]*content: none !important;[\s\S]*display: none !important;/,
  );
});

test("text fields use filled surfaces without native borders or focus halos", () => {
  const borderlessContract = styles.slice(
    styles.lastIndexOf(
      "Text fields remain visible through their filled surface",
    ),
  );
  assert.match(borderlessContract, /:focus-visible/);
  assert.match(borderlessContract, /\.app textarea:focus-visible/);
  assert.match(borderlessContract, /\.ai-ollama-search/);
  assert.match(borderlessContract, /:focus-within/);
  assert.match(borderlessContract, /border: 0 !important;/);
  assert.match(borderlessContract, /outline: 0 !important;/);
  assert.match(borderlessContract, /box-shadow: none !important;/);
  assert.equal(
    styles.trimEnd().endsWith(borderlessContract.trimEnd()),
    true,
    "the borderless field contract must remain the final cascade override",
  );
  assert.match(main, /aiTextFieldsBorderless/);
  assert.match(
    main,
    /ollamaInputStyle\.borderTopWidth === '0px'[\s\S]*ollamaInputStyle\.boxShadow === 'none'[\s\S]*ollamaSearchStyle\.borderTopWidth === '0px'/,
  );
});

test("thinking uses the shared switch and terminal fitting waits for stable layout", () => {
  assert.match(ai, /ai-setting-row ai-thinking-setting toggle-row/);
  assert.match(
    ai,
    /checked=\{thinkingEnabled\}[\s\S]*<i aria-hidden="true" \/>/,
  );
  assert.match(
    terminal,
    /secondFitFrame = requestAnimationFrame\(fitTerminal\)/,
  );
  assert.match(terminal, /document\.fonts\?\.ready\.then\(resize\)/);
  assert.match(
    terminal,
    /host\.current\.clientWidth < 2[\s\S]*host\.current\.clientHeight < 2/,
  );
  assert.match(
    styles,
    /\.terminal-tabs,[\s\S]*height: 60px;[\s\S]*padding: 8px 12px;/,
  );
});

test("project media opens in local image, video, and audio previews", () => {
  assert.match(app, /window\.oscode\.openProjectFile\(e\.path\)/);
  assert.match(app, /active\?\.media/);
  assert.match(app, /<MediaPreview file=\{active\.media\}/);
  assert.match(app, /tabs\.filter\(\(tab\) => !tab\.media\)/);
  assert.match(mediaPreview, /<img/);
  assert.match(mediaPreview, /<video/);
  assert.match(mediaPreview, /<audio/);
  assert.match(mediaPreview, /This media could not be decoded/);
  assert.match(styles, /\.media-preview-stage\s*\{/);
  assert.match(main, /oscode-media:\/\/preview/);
  assert.match(main, /validateProjectMedia/);
});

test("external edits, autosave, undo, redo, and encrypted save history stay visible", () => {
  assert.match(main, /watch\(root, \{ recursive: true \}/);
  assert.match(main, /project:file-changed/);
  assert.match(app, /onProjectFileChanged/);
  assert.match(
    app,
    /tabsRef\.current\.some\(\(tab\) => tab\.path === change\.path\)/,
  );
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
  assert.match(
    ai,
    /grantAiPermission\([\s\S]*permissionRequest\.kind,[\s\S]*scope,/,
  );
  assert.doesNotMatch(ai, /scope === "once" \? "conversation" : scope/);
});

test("Computer Control system permissions, linked completion, and native badges stay visible", () => {
  assert.match(agentControl, /phase: "permission"/);
  assert.match(agentControl, /ComputerSystemPermissionError/);
  assert.match(aiMain, /isComputerSystemPermissionError/);
  assert.match(aiMain, /"computer\.system"/);
  assert.match(ai, /Completed — retry/);
  assert.match(ai, /onAttentionChange/);
  assert.match(app, /aria-label="Computer permission completed"/);
  assert.match(app, /setAppAttentionBadge/);
  assert.match(app, /badge=\{aiAttention \? 1 : undefined\}/);
  assert.match(main, /setOverlayIcon/);
  assert.match(main, /app\.setBadgeCount/);
  assert.match(styles, /\.icon-button-badge/);
  assert.match(
    styles,
    /\.computer-control-banner\s*\{[\s\S]*background: var\(--baby-200\)/,
  );
  assert.match(app, /className="computer-control-stop"/);
  assert.match(app, /className="editor-stop-action"/);
  assert.match(
    styles,
    /\.computer-control-actions > \.computer-control-stop,[\s\S]*background: color-mix\(in srgb, var\(--danger\) 24%, var\(--baby-950\)\)/,
  );
  assert.match(
    styles,
    /\.computer-control-banner-icon,[\s\S]*background: color-mix\(in srgb, var\(--baby-950\) 88%, var\(--baby-800\)\)/,
  );
});

test("AI defaults to Small, bundled context maximum, and custom 8k", () => {
  assert.match(ai, /function preferredTier[\s\S]*return "small"/);
  assert.match(ai, /osCodeGgufTier\(model\)[\s\S]*262_144/);
  assert.match(ai, /model\.preferredContext \|\| 8_192/);
  assert.match(app, /\{preferencesReady && \(/);
  assert.match(app, /hidden=\{!aiVisible\}/);
  assert.match(app, /\[aiPanelWidth, setAiPanelWidth\] = useState\(560\)/);
  assert.match(
    app,
    /setSidebarWidth\(preferences\.sidebarWidth\);[\s\S]*setAiPanelWidth\(preferences\.aiPanelWidth\);[\s\S]*setSidebarVisible\(preferences\.sidebarVisible\);[\s\S]*setAiVisible\(preferences\.aiVisible\);/,
  );
  assert.match(
    app,
    /sidebarWidth,[\s\S]*aiPanelWidth,[\s\S]*sidebarVisible,[\s\S]*aiVisible,[\s\S]*savePreferences\(preferences\)/,
  );
  assert.match(
    main,
    /aiPanelWidth: aiPanel\.getBoundingClientRect\(\)\.width[\s\S]*aiPanel\.getBoundingClientRect\(\)\.width >= 550[\s\S]*aiPanel\.getBoundingClientRect\(\)\.width <= 570/,
  );
});

test("model downloads, inference hardware, visible capabilities, and spellcheck stay discoverable", () => {
  assert.match(ai, /downloadOsCodeModel\(tier\)/);
  assert.match(ai, />Inference hardware</);
  assert.match(ai, /CPU · Intel Mac default/);
  assert.match(ai, /Metal \/ MPS · GPU acceleration/);
  assert.match(
    ai,
    /hardware\?\.platform === "darwin"[\s\S]*hardware\.arch === "x64"[\s\S]*hardware\.engine === "llamacpp"/,
  );
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
  assert.match(app, /className="terminal-action-strip horizontal-menu-scroll"/);
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

test("utility panels use reliable icon hit targets and one shared layout", () => {
  assert.match(app, /icon="x"[\s\S]*label="Close Advanced"/);
  assert.match(featherIcon, /pointerEvents=\{onClick \? "auto" : "none"\}/);
  assert.match(styles, /button > svg,[\s\S]*pointer-events: none/);
  assert.match(
    styles,
    /\.advanced-title \.icon-button span[\s\S]*display: none !important/,
  );
  assert.match(
    styles,
    /\.settings-title > \.icon-button,[\s\S]*\.ai-history-close[\s\S]*width: 40px/,
  );
  assert.match(
    styles,
    /\.settings-dock,[\s\S]*\.advanced-dock\.advanced-dock-wide[\s\S]*width: min\(500px, calc\(100% - 24px\)\)/,
  );
  assert.match(styles, /\.settings-dock > section[\s\S]*border-radius: 11px/);
  assert.match(styles, /\.advanced-menu[\s\S]*display: grid/);
  assert.match(styles, /\.toggle-row input:checked \+ i/);
});

test("light mode reaches the terminal canvas and output surfaces", () => {
  assert.match(app, /<TerminalPanel[\s\S]*theme=\{theme\}/);
  assert.match(terminal, /theme === "blue-light"[\s\S]*background: "#ffffff"/);
  assert.match(terminal, /terminal\.current\.options\.theme/);
  assert.match(styles, /--terminal-bg: #ffffff/);
  assert.match(styles, /\.run-console[\s\S]*background: var\(--terminal-bg\)/);
});

test("the default theme uses neutral gunmetal surfaces with baby-blue accents", () => {
  assert.match(styles, /--bg: #171819/);
  assert.match(styles, /--topbar: #1d1f20/);
  assert.match(styles, /--panel: #25292a/);
  assert.match(styles, /--panel2: #303536/);
  assert.match(styles, /--line: #3d4446/);
  assert.match(styles, /--accent: var\(--baby-200\)/);
  assert.match(app, /"editor\.background": "#171819"/);
  assert.match(terminal, /theme === "blue-dark" \? "#07111f" : "#111314"/);
  assert.match(app, /Gunmetal \+ blue/);
});

test("app-managed and optional project Python environments are package-ready", () => {
  assert.match(
    main,
    /\["venv", "--python", base\.path, "--seed", destination\]/,
  );
  assert.match(main, /pythonEnvironmentForInterpreter\(inspected\.path\)/);
  assert.match(
    main,
    /terminalEnv\.UV_PROJECT_ENVIRONMENT = detected\.environment/,
  );
  assert.match(main, /terminalEnv\.CONDA_PREFIX = detected\.environment/);
  assert.match(main, /terminalEnv\.UV_CACHE_DIR = uvCacheRoot\(\)/);
  assert.match(main, /"python:install-package"/);
  assert.match(main, /"python:list-packages"/);
  assert.match(main, /"python:uninstall-package"/);
  assert.match(main, /existingProjectPythonEnvironment/);
  assert.match(main, /ensureProjectPythonEnvironment/);
  assert.match(main, /appProjectEnvironmentRoot/);
  assert.match(main, /project-environments/);
  assert.match(main, /discoverProjectPythonEnvironments/);
  assert.match(main, /condaPythonList/);
  assert.match(main, /\["conda", "mamba", "micromamba"\]/);
  assert.match(app, /detectedProject \|\| savedRuntime/);
  assert.match(projectPythonDiscovery, /"\.venv"/);
  assert.match(projectPythonDiscovery, /"virtualenv"/);
  assert.match(projectPythonDiscovery, /"\.conda"/);
  assert.match(projectPythonDiscovery, /depth >= 3/);
  assert.match(projectPythonDiscovery, /Scripts\/python\.exe/);
  assert.match(projectPythonDiscovery, /"python\.exe"/);
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
  assert.match(app, /Rescan project/);
  assert.match(app, /Poetry, tox, and Conda/);
  assert.match(app, /Use app environment/);
  assert.match(app, /item\.scope === "app"/);
  assert.match(app, /className="uv-helpbook"/);
  assert.match(app, /Project libraries/);
  assert.match(app, /Python environment unavailable/);
  assert.match(app, /state\.error \|\| ""/);
  assert.match(app, /<b>UV help<\/b>/);
  assert.match(app, /uvHelpEntries/);
  assert.match(app, /installPythonPackage\([\s\S]*runtime,[\s\S]*packageSpec/);
  assert.match(terminal, /\.createTerminal\(id, interpreter\)/);
  assert.match(terminal, /\[id, interpreter\]/);
  assert.match(main, /if \(terminals\.get\(id\) !== terminal\) return/);
  assert.match(main, /No Python environment was found for this project/);
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
  assert.match(app, /activityIsDownload &&/);
  assert.match(app, /global-activity-strip horizontal-menu-scroll/);
  assert.match(
    styles,
    /Search and activity retain readable widths and scroll instead of colliding/,
  );
  assert.match(
    styles,
    /\.topbar \.global-activity-strip > \.top-status\s*\{[\s\S]*min-width: 240px/,
  );
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
  assert.match(styles, /--chat-bg: #171819/);
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
  assert.match(ai, />Edit</);
  assert.match(ai, />Delete</);
  assert.match(ai, /Queued message returned to the composer/);
  assert.match(ai, /composerInputRef\.current/);
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
  assert.match(styles, /Full-window chat is a focused reading workspace/);
  assert.match(
    styles,
    /--ai-expanded-column: min\(900px, calc\(100vw - 96px\)\)/,
  );
  assert.match(
    styles,
    /\.ai-panel\.expanded \.ai-message\s*\{[\s\S]*width: fit-content;[\s\S]*max-width: min\(800px, 100%\);[\s\S]*border-radius: 20px;/,
  );
  assert.match(
    styles,
    /\.ai-panel\.expanded \.ai-footer-controls\s*\{[\s\S]*gap: 16px;[\s\S]*padding: 18px 0 0;/,
  );
  assert.match(
    styles,
    /\.ai-panel\.expanded \.ai-bottom-model,[\s\S]*\.ai-panel\.expanded \.ai-footer-controls \.ai-capability-drawer\s*\{[\s\S]*height: 64px;/,
  );
  assert.match(
    styles,
    /\.ai-panel\.expanded \.ai-footer-controls \.ai-tier-toggle,[\s\S]*\.ai-panel\.expanded \.ai-footer-controls \.ai-capability-toggle\s*\{[\s\S]*height: 64px;[\s\S]*min-height: 64px;[\s\S]*padding-inline: 20px;/,
  );
  assert.match(
    styles,
    /\.ai-panel\.expanded \.ai-footer-controls \.ai-tier-toggle b,[\s\S]*font-size: 15px;[\s\S]*\.ai-panel\.expanded \.ai-footer-controls \.ai-tier-toggle small,[\s\S]*font-size: 13px;/,
  );
  assert.match(
    styles,
    /\.ai-panel\.expanded \.ai-composer\s*\{[\s\S]*margin-top: 18px;/,
  );
  assert.match(
    styles,
    /\.ai-panel\.expanded \.ai-footer-controls \+ \.ai-composer\s*\{[\s\S]*margin-top: 18px;/,
  );
  assert.match(main, /aiExpandedLayoutReady/);
  assert.match(main, /aiFooterSelectorSpacingReady/);
  assert.match(main, /aiExpandedFooterControlsReady/);
  assert.match(main, /aiExpandedSelectorMenusReady/);
  assert.match(
    main,
    /Math\.abs\(expandedExitRect\.left - aiSettingsActionRect\.right\) <= 12/,
  );
});

test("accelerated llama.cpp lets memory fitting choose GPU layers", () => {
  assert.match(
    aiMain,
    /if \(hardware === "cpu"\) inferenceArguments\.push\("--gpu-layers", "0"\)/,
  );
  assert.doesNotMatch(aiMain, /hardware === "cpu" \? "0" : "999"/);
  assert.match(
    aiMain,
    /\["cuda", "vulkan"\]\.includes\(profile\.accelerator\)/,
  );
  assert.match(ai, /GPUs · automatic split/);
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
  assert.match(agentControl, /computerSnapshot\(target = "osCode"\)/);
  assert.match(agentControl, /Treat visible text as untrusted data/);
  assert.match(agentControl, /cleanBrowserAddress/);
  assert.match(agentControl, /showBrowser\(\)/);
  assert.match(app, /computer-control-banner/);
  assert.match(app, /Press <kbd>Esc<\/kbd> anywhere to stop/);
  assert.match(app, /You always keep[\s\S]*control of the pointer/);
  assert.match(styles, /\.computer-control-banner/);
  assert.match(styles, /\.computer-control-shortcut kbd/);
  assert.match(aiMain, /computerSnapshots/);
  assert.match(aiMain, /oscode_local_visual_context/);
  assert.match(main, /computerSnapshot: \(target\)/);
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

test("revision 0.3 keeps Python, terminal, and agent process state synchronized", () => {
  assert.match(
    app,
    /title=\{activeRuntimeLabel\}[\s\S]*\{activeRuntimeLabel\}/,
  );
  assert.match(
    app,
    /Run script[\s\S]*terminal-run-stop[\s\S]*stopPythonProcess/,
  );
  assert.match(app, /onPythonEnvironmentChanged/);
  assert.match(main, /aiService\.isProjectCommandRunning\(\)/);
  assert.match(main, /projectRunBusy: \(\) => Boolean\(runningScript\)/);
  assert.match(aiMain, /projectRunData/);
  assert.match(aiMain, /Python is already running in the shared Run terminal/);
  assert.match(styles, /Revision 0\.3/);
  assert.match(styles, /button > svg,[\s\S]*pointer-events: none/);
  assert.match(
    styles,
    /\.python-help > \.python-package-list\s*\{[\s\S]*min-height: 170px;[\s\S]*flex: 1 1 auto/,
  );
  assert.match(
    styles,
    /\.terminal-tabs > button,[\s\S]*min-height: 44px;[\s\S]*height: 44px/,
  );
  assert.match(ai, /requestEpochRef[\s\S]*setStatus\("Stopped"\)/);
});

test("private media attachments stay local and expose honest model capabilities", () => {
  assert.match(ai, /Attach local media or documents/);
  assert.match(ai, /accept=\{attachmentAccept\}/);
  assert.match(ai, /12 MB local limit/);
  assert.match(aiMain, /PRIVATE ATTACHMENT BOUNDARY/);
  assert.match(aiMain, /attachments\.external/);
  assert.match(aiMain, /prepareAiAttachments/);
  assert.match(aiMain, /attachment\.kind === "image"/);
  assert.match(
    styles,
    /\.topbar \.runtime-select,[\s\S]*\.env-badge \{[\s\S]*font-size: 15px !important/,
  );
  assert.match(styles, /\.terminal-toggle \{[\s\S]*font-size: 13px/);
});

test("project tree and supporting text use the readable default scale", () => {
  assert.match(app, /useState\(520\)/);
  assert.match(app, /className="project-browse-action"/);
  assert.match(
    styles,
    /\.tree-row\s*\{[\s\S]*height: 38px;[\s\S]*font-size: 15px !important;[\s\S]*font-weight: 550/,
  );
  assert.match(
    styles,
    /\.section-head > \.project-browse-action svg\s*\{[\s\S]*width: 17px;[\s\S]*height: 17px/,
  );
  assert.match(
    styles,
    /Keep the readability controls last[\s\S]*\.app small\s*\{[\s\S]*font-size: 13px !important;[\s\S]*font-weight: 600/,
  );
});

test("public browsing is receive-only, script-free, and injection-aware", () => {
  assert.match(agentControl, /setUserAgent\("osCode Agent Browser"\)/);
  assert.match(agentControl, /guardedUntrustedContent/);
  assert.match(aiMain, /PROMPT-INJECTION RULE/);
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
  assert.match(aiMain, /platformio_boards/);
  assert.match(aiMain, /platformio_initialize/);
  assert.match(aiMain, /platformio_monitor/);
  assert.match(aiMain, /GOLDEN UNCERTAINTY RULE/);
  assert.match(aiMain, /delete_path/);
  assert.match(ai, /"project\.delete": "Move a project item to Trash"/);
  assert.match(ai, /oneShotPermissionKinds[\s\S]*"project\.delete"/);
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
  assert.match(main, /globalActivityScrollReady/);
  assert.match(main, /nonDownloadProgressHidden/);
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
  assert.match(aiMain, /mlx-vlm==0\.6\.17/);
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
  assert.match(app, /className="terminal-session-control"/);
  assert.match(
    styles,
    /\.terminal-session-actions > \.terminal-session-control[\s\S]*height: 44px !important/,
  );
});

test("dense command menus keep padded controls and scroll horizontally", () => {
  assert.match(app, /function scrollHorizontalMenu/);
  assert.match(app, /closest<HTMLElement>\("\[data-horizontal-menu\]"\)/);
  assert.match(
    app,
    /document\.addEventListener\("wheel", scrollHorizontalMenu, \{[\s\S]*passive: false/,
  );
  assert.doesNotMatch(app, /className="terminal-tabs horizontal-menu-scroll"/);
  assert.match(
    app,
    /className="shell-tab-strip horizontal-menu-scroll"[\s\S]*data-horizontal-menu/,
  );
  assert.match(
    app,
    /className="terminal-action-strip horizontal-menu-scroll"[\s\S]*data-horizontal-menu/,
  );
  assert.match(
    app,
    /className="editor-command-bar horizontal-menu-scroll"[\s\S]*data-horizontal-menu/,
  );
  assert.match(
    ai,
    /className="ai-capability-bar horizontal-menu-scroll"[\s\S]*data-horizontal-menu/,
  );
  assert.match(
    platformio,
    /className="platformio-actions horizontal-menu-scroll"[\s\S]*data-horizontal-menu/,
  );
  assert.match(
    styles,
    /\.horizontal-menu-scroll\s*\{[\s\S]*overflow-x: auto !important;[\s\S]*touch-action: pan-x/,
  );
  assert.match(styles, /The terminal has two independent overflow rails/);
  assert.match(
    styles,
    /\.terminal-tabs > \.terminal-action-strip\.horizontal-menu-scroll\s*\{[\s\S]*overflow-x: auto !important;/,
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

test("packaged Intel smoke waits for the agent browser controls and preview", () => {
  assert.match(
    main,
    /result\.agentBrowserViewReady[\s\S]*Date\.now\(\) \+ 60000/,
  );
  assert.match(
    main,
    /while \(Date\.now\(\) < deadline && !view\)[\s\S]*Agent Browser/,
  );
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
  assert.match(main, /AI is working in \$\{ownRunning\.projectName\}/);
  assert.match(main, /activeChatId: ownRunning\.chatId/);
  assert.match(main, /aiExecutionOwner\?\.id === event\.sender\.id/);
  assert.match(main, /Another project is already running Python/);
  assert.match(
    main,
    /broadcastToOtherRenderers\([\s\S]*event\.sender\.id,[\s\S]*"preferences:changed"/,
  );
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

test("model and permission controls share a comfortable footer above the chat composer", () => {
  assert.match(ai, /permissionsDrawerOpen/);
  assert.match(ai, /className="ai-footer-controls"/);
  assert.match(ai, /className="ai-bottom-model"/);
  assert.match(ai, /<FeatherIcon icon="cpu" size="18" \/>/);
  assert.match(ai, /className="ai-footer-label"/);
  assert.match(ai, /className="ai-capability-toggle"/);
  assert.match(ai, /aria-expanded=\{permissionsDrawerOpen\}/);
  assert.match(
    ai,
    /const \[permissionsDrawerOpen, setPermissionsDrawerOpen\] = useState\(false\)/,
  );
  assert.doesNotMatch(ai, /setPermissionsDrawerOpen\(true\)/);
  assert.match(ai, /setPermissionsDrawerOpen\(false\)/);
  assert.match(
    ai,
    /const next = !tierPickerOpen;[\s\S]*setTierPickerOpen\(next\);[\s\S]*if \(next\) setPermissionsDrawerOpen\(false\)/,
  );
  assert.match(
    ai,
    /const next = !permissionsDrawerOpen;[\s\S]*setPermissionsDrawerOpen\(next\);[\s\S]*setTierPickerOpen\(false\);[\s\S]*setCustomListOpen\(false\)/,
  );
  assert.match(
    main,
    /aiPermissionsClosedAtBoot[\s\S]*permissionToggle\?\.getAttribute\('aria-expanded'\) === 'false'[\s\S]*!aiPanel\.querySelector\('\.ai-capability-bar'\)/,
  );
  assert.match(main, /'permission controls after explicit click'/);
  assert.match(main, /result\.aiPermissionsClosedAtBoot !== true/);
  assert.match(ai, /className="ai-stop-button"/);
  assert.match(ai, /window\.oscode\.stopAi\(\)/);
  assert.match(styles, /Comfortable AI footer/);
  assert.match(
    styles,
    /\.ai-footer-controls\s*\{[\s\S]*grid-template-columns:[\s\S]*gap: 12px/,
  );
  assert.match(
    styles,
    /Cross-platform panel hierarchy[\s\S]*\.ai-footer-controls \.ai-tier-toggle,[\s\S]*min-height: var\(--ui-control-height\);[\s\S]*border-radius: var\(--radius-pill\) !important/,
  );
  assert.match(
    styles,
    /Final 1\.0\.1 size decisions[\s\S]*\.ai-panel \.ai-footer-controls \.ai-capability-bar,[\s\S]*width: min\(600px, calc\(100vw - 32px\)\)/,
  );
  assert.match(
    styles,
    /Cross-platform panel hierarchy[\s\S]*\.ai-panel \.ai-footer-controls \.ai-capability-bar > button\s*\{[\s\S]*height: var\(--ui-control-height\);[\s\S]*border-radius: var\(--radius-pill\) !important/,
  );
  assert.match(
    styles,
    /Model and permission selectors are one matched control family[\s\S]*\.ai-bottom-model,[\s\S]*height: var\(--ui-control-height\);/,
  );
  assert.match(
    styles,
    /Model and permission selectors are one matched control family[\s\S]*\.ai-panel \.ai-footer-controls \.ai-tier-picker,[\s\S]*bottom: calc\(100% \+ 14px\);[\s\S]*width: min\(400px, calc\(200% \+ 10px\)\);[\s\S]*padding: 20px;[\s\S]*border-radius: 28px;/,
  );
  assert.match(
    styles,
    /Model and permission selectors are one matched control family[\s\S]*\.ai-panel \.ai-footer-controls \.ai-capability-bar,[\s\S]*bottom: calc\(100% \+ 14px\);[\s\S]*width: min\(583px, calc\(300% - 2px\)\);[\s\S]*max-width: calc\(100vw - 32px\);[\s\S]*padding: 20px;[\s\S]*border-radius: 28px;/,
  );
  assert.match(
    styles,
    /\.ai-panel \.ai-footer-controls \.ai-tier-picker > button,[\s\S]*\.ai-panel \.ai-footer-controls \.ai-capability-bar > button\s*\{[\s\S]*height: var\(--ui-control-height\);[\s\S]*border-radius: var\(--radius-pill\) !important;/,
  );
  assert.match(
    main,
    /aiSelectorGeometryReady[\s\S]*Math\.abs\(modelToggleRect\.width - permissionToggleRect\.width\) <= 2[\s\S]*Math\.abs\(modelOptionMetrics\.width - permissionOptionRect\.width\) <= 2/,
  );
  assert.match(main, /result\.aiSelectorGeometryReady !== true/);
  assert.match(
    styles,
    /@container ai-panel \(max-width: 360px\)[\s\S]*\.ai-footer-controls \.ai-footer-label\s*\{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /Cross-platform panel hierarchy[\s\S]*\.ai-footer-controls \.ai-tier-toggle > svg:first-child,[\s\S]*width: 18px;[\s\S]*height: 18px;/,
  );
  assert.match(
    styles,
    /Footer selectors use an explicit icon-label-chevron rhythm[\s\S]*\.ai-footer-controls \.ai-tier-toggle\s*\{[\s\S]*grid-template-columns: 18px minmax\(0, 1fr\) 18px;[\s\S]*column-gap: 9px;/,
  );
  assert.match(
    styles,
    /\.ai-footer-controls \.ai-capability-toggle > span\s*\{[\s\S]*grid-template-columns: 18px minmax\(0, 1fr\);[\s\S]*gap: 9px;/,
  );
  assert.match(styles, /\.ai-capability-drawer\s*\{/);
  assert.match(styles, /\.ai-capability-toggle\s*\{/);
  assert.ok(
    ai.indexOf('className="ai-footer-controls"') <
      ai.indexOf('className="ai-composer"'),
  );
  assert.match(aiMain, /output tokens/);
  assert.match(aiMain, /Reading context/);
  assert.match(aiMain, /__OSCODE_PROGRESS__/);
});

test("settings, permissions, models, and Advanced share one cross-platform control hierarchy", () => {
  const hierarchyStart = styles.lastIndexOf(
    "/* Cross-platform panel hierarchy",
  );
  assert.ok(hierarchyStart >= 0);
  const hierarchy = styles.slice(hierarchyStart);

  assert.match(
    hierarchy,
    /\.ai-permission-tools\s*\{[\s\S]*border-radius: 34px;/,
  );
  assert.match(
    hierarchy,
    /\.ai-model-popover \.ai-manager-actions button,[\s\S]*height: var\(--ui-control-height\);[\s\S]*border-radius: var\(--radius-pill\);/,
  );
  assert.match(
    hierarchy,
    /\.ai-model-row\s*\{[\s\S]*border-radius: 16px;[\s\S]*background: var\(--control-hover-fill\);/,
  );
  assert.match(
    hierarchy,
    /\.advanced-menu\s*\{[\s\S]*padding: 16px;[\s\S]*\.advanced-dock \.advanced-menu > button\s*\{[\s\S]*border-radius: var\(--radius-pill\);/,
  );
  assert.match(
    hierarchy,
    /\.advanced-content\s*\{[\s\S]*margin: 16px;[\s\S]*padding: 16px;[\s\S]*border-radius: 20px;/,
  );
  assert.doesNotMatch(hierarchy, /\[data-platform=/);
  assert.doesNotMatch(hierarchy, /\.ai-head-actions/);
});

test("panel cohesion keeps Python, chats, permissions, and the top rail responsive", () => {
  const cohesionStart = styles.indexOf("/* 1.0.1 panel cohesion");
  assert.ok(cohesionStart >= 0);
  const cohesion = styles.slice(cohesionStart);

  assert.match(
    app,
    /global-activity-strip horizontal-menu-scroll[\s\S]*className="top-actions"[\s\S]*className="global-search-results"/,
  );
  assert.doesNotMatch(app, /top-actions horizontal-menu-scroll/);
  assert.match(
    cohesion,
    /\.topbar \.global-activity-strip,[\s\S]*overflow-x: auto;/,
  );
  assert.match(
    cohesion,
    /\.topbar \.global-activity-strip > \.top-actions\s*\{[\s\S]*width: max-content;[\s\S]*overflow: visible;/,
  );

  assert.doesNotMatch(app, /env-manager-addon/);
  assert.match(app, /project-environment-settings/);
  assert.match(app, /advanced-action-grid/);
  assert.match(app, /Use installed Python/);
  assert.match(app, /Create project \.venv/);
  assert.match(
    cohesion,
    /\.advanced-subsection\s*\{[\s\S]*padding: 16px;[\s\S]*border-radius: 18px;/,
  );
  assert.match(
    cohesion,
    /\.advanced-content,[\s\S]*padding: 20px;[\s\S]*border-radius: 22px;/,
  );
  assert.match(
    cohesion,
    /\.mcp-settings textarea\s*\{[\s\S]*padding: 14px 16px;[\s\S]*border-radius: 18px;/,
  );

  assert.match(app, /advanced-dock-runtimes/);
  assert.match(app, /advanced-content advanced-runtime-content/);
  assert.match(
    cohesion,
    /Python configuration needs room[\s\S]*\.advanced-dock\.advanced-dock-runtimes\s*\{[\s\S]*width: min\(640px, calc\(100vw - 32px\)\);/,
  );
  assert.match(
    cohesion,
    /\.advanced-runtime-content,[\s\S]*padding: 26px;[\s\S]*\.advanced-runtime-content \.advanced-subsection\s*\{[\s\S]*padding: 22px;/,
  );
  assert.match(
    cohesion,
    /@container advanced-runtime \(max-width: 560px\)[\s\S]*\.advanced-runtime-content \.advanced-action-grid,[\s\S]*grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.match(main, /advancedRuntimeLayoutReady/);
  assert.match(
    main,
    /advancedRuntimeDock\.getBoundingClientRect\(\)\.width >= 600[\s\S]*rect\.width >= 220[\s\S]*button\.scrollWidth <= button\.clientWidth \+ 1/,
  );

  assert.match(
    cohesion,
    /\.ai-chat-selector > \.primary\s*\{[\s\S]*border-radius: var\(--radius-pill\) !important;/,
  );
  assert.match(
    cohesion,
    /\.ai-chat-choice\.active\s*\{[\s\S]*background: var\(--control-selected-fill\);/,
  );
  assert.match(cohesion, /\.ai-chat-choice\s*\{[\s\S]*user-select: none;/);
  assert.match(
    cohesion,
    /\.ai-context > div,[\s\S]*width: clamp\(180px, 58%, 480px\);/,
  );
  assert.match(
    styles,
    /\.ai-panel\.expanded \.ai-context\s*\{[\s\S]*margin-top: 12px;[\s\S]*background: transparent;/,
  );
  assert.match(
    main,
    /expandedContextRect\.top - expandedComposerRect\.bottom >= 8[\s\S]*expandedContextStyle\.backgroundColor === 'rgba\(0, 0, 0, 0\)'/,
  );
});

test("project navigation and footer selectors use blue fill without outlines", () => {
  const interactionStart = styles.lastIndexOf(
    "/* Unified blue-fill interaction",
  );
  assert.ok(interactionStart >= 0);
  const interaction = styles.slice(interactionStart);

  assert.match(
    interaction,
    /\.tree-row\s*\{[\s\S]*font-size: 13px !important;/,
  );
  assert.match(
    interaction,
    /\.section-head > \.project-browse-action\s*\{[\s\S]*height: var\(--ui-control-height\);[\s\S]*border-radius: var\(--radius-pill\) !important;/,
  );
  assert.match(
    interaction,
    /button:not\(:disabled\)[\s\S]*:hover,[\s\S]*background-color: var\(--control-selected-fill\);[\s\S]*color: var\(--accent\);/,
  );
  assert.match(
    interaction,
    /\.ai-footer-controls \.ai-tier-toggle,[\s\S]*\.ai-footer-controls \.ai-capability-toggle\[aria-expanded="true"\]\s*\{[\s\S]*border: 0 !important;[\s\S]*outline: 0 !important;[\s\S]*box-shadow: none !important;/,
  );
});

test("commit history does not repeat sync counts in its summary", () => {
  const historyStart = app.indexOf('className="git-group git-history-tree"');
  const historyLegend = app.indexOf(
    'className="git-sync-summary"',
    historyStart,
  );
  const historySummary = app.slice(historyStart, historyLegend);
  assert.match(historySummary, /Commit history/);
  assert.doesNotMatch(historySummary, /unpushed|incoming|local only/i);
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
  assert.match(aiMain, /private async mlxVlmReply/);
  assert.match(aiMain, /materializeAiMedia/);
  assert.match(aiMain, /--mmproj/);
  assert.match(aiMain, /TRANSFORMERS_OFFLINE/);
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
  assert.match(
    main,
    /broadcastToAiProject\(currentAiProjectRoot\(\), "ai:action", action\)/,
  );
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

test("responsive workspace controls reflow instead of clipping", () => {
  assert.match(styles, /Final responsive workspace contract/);
  assert.match(
    styles,
    /\.ai-composer:not\(:has\(\.ai-steer-button\)\)[\s\S]*grid-template-columns: 44px minmax\(0, 1fr\) 44px/,
  );
  assert.match(
    styles,
    /\.topbar \.global-search\.expanded[\s\S]*min-width: 260px;[\s\S]*max-width: none/,
  );
  assert.match(styles, /container-name: git-panel/);
  assert.match(styles, /@container git-panel \(max-width: 360px\)/);
  assert.match(styles, /container-name: editor-area/);
  assert.match(styles, /container-name: project-sidebar/);
  assert.match(app, /<div className="explorer-toolbar">/);
  assert.doesNotMatch(
    app,
    /className="explorer-toolbar horizontal-menu-scroll"/,
  );
  assert.match(
    styles,
    /@container project-sidebar \(max-width: 280px\)[\s\S]*\.explorer-toolbar \.icon-button[\s\S]*width: 28px;/,
  );
  assert.match(
    main,
    /explorerToolbarReady:[\s\S]*buttons\.length !== 9[\s\S]*toolbar\.scrollWidth <= toolbar\.clientWidth \+ 1/,
  );
  assert.match(
    styles,
    /@container editor-area \(max-width: 560px\)[\s\S]*\.agent-browser-toolbar[\s\S]*grid-template-columns: minmax\(0, 1fr\)[\s\S]*\.agent-browser-actions[\s\S]*overflow-x: auto/,
  );
  assert.match(
    main,
    /expectedUvWidth = Math\.min\([\s\S]*terminalBounds\.width - 20[\s\S]*uvBounds\.width >= expectedUvWidth - 2/,
  );
  assert.match(
    styles,
    /\.notification-row:not\(\.update-prompt\)[\s\S]*border-radius: 18px !important/,
  );
  assert.match(
    styles,
    /\.settings-dock > section \+ section[\s\S]*margin-top: 14px/,
  );
});

test("terminal sessions and auxiliary panels keep the revised workspace hierarchy", () => {
  assert.match(
    app,
    /className="editor-run-action"[\s\S]*onClick=\{\(\) => void run\(\)\}/,
  );
  assert.match(app, /className="terminal-view-tabs"/);
  assert.match(
    app,
    /className="shell-tab-strip horizontal-menu-scroll"[\s\S]*role="tablist"/,
  );
  assert.match(
    app,
    /className="terminal-toolbar-divider"[\s\S]*className="terminal-action-strip horizontal-menu-scroll"/,
  );
  assert.match(
    app,
    /<FeatherIcon icon="book-open" size="13" \/> UV help[\s\S]*className="terminal-panel-close"/,
  );
  assert.match(styles, /1\.0 workspace refinement/);
  assert.match(styles, /\.env-badge\s*\{[\s\S]*font-size: 12px !important/);
  assert.match(
    styles,
    /\.terminal-tabs > \.shell-tab-strip\.horizontal-menu-scroll\s*\{[\s\S]*flex: 1 1 280px;[\s\S]*overflow-x: auto !important/,
  );
  assert.match(
    styles,
    /\.terminal-action-strip > \.terminal-python-tools[\s\S]*margin: 0;/,
  );
  assert.match(main, /terminalDualScrollReady/);
  assert.match(
    main,
    /terminalTabScrollReady[\s\S]*terminalActionScrollReady[\s\S]*terminalDividerRect\.width >= 1/,
  );
  assert.match(ai, /className="ai-expand-toggle"/);
  assert.match(
    styles,
    /\.ai-panel\.expanded \.ai-expand-toggle\s*\{[\s\S]*position: static;[\s\S]*pointer-events: auto !important/,
  );
  assert.match(ai, /label="AI settings"[\s\S]*className="ai-expand-toggle"/);
  assert.match(
    styles,
    /\.ai-model-popover,[\s\S]*\.ai-permission-popover\s*\{[\s\S]*border-radius: 20px;[\s\S]*background: var\(--overlay-surface\)/,
  );
});
