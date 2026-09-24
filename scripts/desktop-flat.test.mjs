import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const main = await fs.readFile(
  new URL("../src/main.tsx", import.meta.url),
  "utf8",
);
const app = await fs.readFile(
  new URL("../src/App.tsx", import.meta.url),
  "utf8",
);
const css = await fs.readFile(
  new URL("../src/desktop-flat.css", import.meta.url),
  "utf8",
);
const ai = await fs.readFile(
  new URL("../src/components/AiPanel.tsx", import.meta.url),
  "utf8",
);

test("desktop flat design keeps the editor toolbar scrollable and updates Paper Light", () => {
  assert.match(
    main,
    /import "\.\/notifications\.css";\s*import "\.\/desktop-flat\.css";/,
  );
  assert.match(app, /tr\("Paper light", "فاتح ورقي"\)/);
  assert.match(
    css,
    /\.app\.blue-light\s*\{[^}]*--bg: #ffffff;[^}]*--accent: #397b9d;[^}]*--chat-user: #eef4f7;/s,
  );
  assert.match(
    css,
    /\.editor-command-bar\.horizontal-menu-scroll\s*\{[^}]*overflow-x: auto !important;/s,
  );
  assert.match(
    css,
    /\.ai-message\.assistant\s*\{[^}]*background: transparent !important;/s,
  );
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /--app-font-size: 13px/);
  assert.match(css, /\.ai-composer\.expanded-input/);
  assert.match(css, /\.app \.settings-dock > section/);
  assert.match(ai, /label="AI settings"[\s\S]*toggleAiPopup\("models"\)/);
  assert.match(ai, /<b>Model<\/b>/);
  assert.match(app, /Interface typography applies after restarting osCode/);
});

test("Settings switches match AI settings and Git highlights every pending edit", () => {
  assert.match(
    css,
    /#root \.app \.settings-dock \.toggle-row > i\s*\{[^}]*width: 46px !important;[^}]*height: 26px !important;/s,
  );
  assert.match(
    css,
    /#root \.app \.settings-dock \.toggle-row > input:checked \+ i::after\s*\{[^}]*background: #fff !important;[^}]*translate3d\(20px, 0, 0\)/s,
  );
  assert.match(
    app,
    /const hasPendingGitChanges\s*=\s*git\.initialized\s*&&\s*\(hasDirtyTabs\s*\|\|\s*git\.files\.length > 0\s*\|\|\s*git\.ahead > 0/s,
  );
  assert.match(app, /hasPendingGitChanges \? " has-pending-changes"/);
  assert.match(css, /\.git\.has-pending-changes \.git-panel-head/);
});

test("expanded chat puts user text and send action at the edges without a filled composer", () => {
  assert.match(
    css,
    /#root \.app \.ai-panel\.expanded \.ai-conversation\s*\{[^}]*padding-inline: var\(--ai-expanded-gutter\) !important;/s,
  );
  assert.match(
    css,
    /#root \.app \.ai-panel\.expanded \.ai-message\.user > p\s*\{[^}]*text-align: end;/s,
  );
  assert.match(
    css,
    /#root \.app \.ai-panel\.expanded \.ai-composer\s*\{[^}]*background: transparent !important;/s,
  );
  assert.match(
    css,
    /\.ai-composer:has\(\.ai-composer-stop-button\)[\s\S]*> \.ai-send-button\s*\{\s*grid-column: 6;/,
  );
});

test("chat menus, flat utility panels, and color-only hover survive legacy styles", () => {
  assert.match(
    css,
    /#root \.app \.ai-panel \.ai-footer-controls\s*\{[^}]*z-index: 80 !important;[^}]*overflow: visible !important;/s,
  );
  assert.match(
    css,
    /:is\(\.ai-tier-picker, \.ai-capability-bar\)\s*\{[^}]*z-index: 240 !important;[^}]*overflow-y: auto !important;/s,
  );
  assert.match(
    css,
    /#root \.app \.advanced-dock \.advanced-menu > button\s*\{[^}]*border-radius: 0 !important;[^}]*background: transparent !important;/s,
  );
  assert.match(
    css,
    /#root \.app \.settings-dock \.settings-select-row select\s*\{[^}]*border-radius: 0 !important;[^}]*background-color: transparent !important;/s,
  );
  assert.match(
    css,
    /#root \.app \.git-panel-head \.section-toggle\s*\{[^}]*border-radius: 0 !important;[^}]*background: transparent !important;/s,
  );
  assert.match(
    css,
    /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*background-color: transparent !important;/,
  );
  assert.match(app, /<FeatherIcon icon="plus" size="14" \/>/);
  assert.doesNotMatch(app, /refresh-cw/);
  assert.doesNotMatch(ai, /refresh-cw/);
});

test("responsive workspace menus stay flat, readable, and expandable", () => {
  assert.match(app, /expandedNotificationId/);
  assert.match(app, /className="notification-content"/);
  assert.match(app, /aria-expanded=\{expanded\}/);
  assert.match(app, /className="project-heading-actions"/);
  assert.match(app, /className="project-heading-divider"/);
  assert.match(app, /className="project-close-action"/);
  assert.doesNotMatch(app, /<span className="eyebrow">\{tr\("PROJECT"/);
  assert.match(
    css,
    /#root \.app \.git-panel-head\s*\{[^}]*position: relative !important;[^}]*flex: 0 0 auto;/s,
  );
  assert.match(
    css,
    /#root \.app \.ai-panel \.ai-footer-controls \.ai-tier-picker\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/s,
  );
  assert.match(
    css,
    /#root \.app \.ai-panel \.ai-footer-controls \.ai-capability-bar\s*\{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/s,
  );
  assert.match(
    css,
    /#root \.app \.terminal-host \.xterm\s*\{[^}]*height: 100% !important;/s,
  );
  assert.match(css, /#root \.app \.ai-agent-popover \.ai-chat-choice/);
});

test("Git scrolling, runtime actions, and chat output keep the flat mobile hierarchy", () => {
  assert.match(
    css,
    /#root \.app \.changes-head,[\s\S]*?#root \.app \.git-commit-row\s*\{[^}]*position: relative !important;[^}]*top: auto !important;[^}]*bottom: auto !important;/,
  );
  assert.match(
    css,
    /\.runtime-catalog \.runtime-row > b,[\s\S]*?\.runtime-catalog \.runtime-row > button\s*\{[^}]*width: 112px;[^}]*min-height: 38px;/,
  );
  assert.match(
    css,
    /\.ai-footer-controls \.ai-tier-picker\s*\{[^}]*width: max-content !important;[^}]*max-width: min\(460px,/s,
  );
  assert.match(
    css,
    /\.ai-message\.user\s*\{[^}]*border-radius: 0 !important;[^}]*background: transparent !important;/s,
  );
  assert.match(css, /summary::before\s*\{[^}]*content: "›";/s);
  assert.match(ai, /<span>Thinking<\/span>/);
  assert.match(ai, /<span>Model log<\/span>/);
});
