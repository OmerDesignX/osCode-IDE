import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { FeatherIcon } from "./components/FeatherIcon";
import { IconButton } from "./components/IconButton";
import { FileTree } from "./components/FileTree";
import { TerminalPanel } from "./components/TerminalPanel";
import { AiPanel } from "./components/AiPanel";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { MediaPreview } from "./components/MediaPreview";
import { PlatformioPanel } from "./components/PlatformioPanel";
import osCodeIcon from "./assets/oscode-icon.png";
import { chatSearchPreview } from "./chat-search-preview";
import type {
  AiEditMode,
  AiEngine,
  AiInferenceHardware,
  AiAttention,
  AiTerminalMode,
  AgentActivity,
  AgentBrowserSnapshot,
  AppUpdateStatus,
  EditorPreferences,
  GitCommit,
  GitState,
  McpServerConfig,
  ProjectSearchResult,
  PythonPackage,
  PythonRuntime,
  SaveHistoryEntry,
  Tab,
  TreeEntry,
} from "./types";
const Editor = lazy(() => import("./LocalEditor"));
const SplitEditor = lazy(() => import("./LocalSplitEditor"));
const DiffEditor = lazy(() => import("./LocalDiffEditor"));
type ProjectState = { root: string; name: string; tree: TreeEntry[] };
type AppNotification = {
  id: string;
  message: string;
  createdAt: number;
  kind?: "auto-update-prompt" | "app-update" | "ai-attention" | "message";
};
type FileComparison = {
  leftPath: string;
  leftName: string;
  leftContent: string;
  rightPath: string;
  rightName: string;
  rightContent: string;
};
type ProjectClipboardState = {
  path: string;
  mode: "copy" | "move";
  name: string;
  kind: TreeEntry["kind"];
};
type ProjectContextMenuState = {
  x: number;
  y: number;
  source: "tree" | "tab" | "explorer";
  entry?: TreeEntry;
  tabPath?: string;
};
type ProjectContextAction = {
  label: string;
  icon: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  run: () => unknown | Promise<unknown>;
};
const NOTICE_AUTO_DISMISS_MS = 10_000;

function scrollHorizontalMenu(event: WheelEvent) {
  const origin = event.target;
  const menu =
    origin instanceof Element
      ? origin.closest<HTMLElement>("[data-horizontal-menu]")
      : null;
  if (
    !menu ||
    menu.scrollWidth <= menu.clientWidth + 1 ||
    Math.abs(event.deltaY) <= Math.abs(event.deltaX)
  )
    return;
  const nextScroll = Math.max(
    0,
    Math.min(
      menu.scrollWidth - menu.clientWidth,
      menu.scrollLeft + event.deltaY,
    ),
  );
  if (Math.abs(nextScroll - menu.scrollLeft) < 0.5) return;
  menu.scrollLeft = nextScroll;
  event.preventDefault();
}
const agentBrowserTabPath = "oscode://agent-browser";
const projectFiles = (entries: TreeEntry[]): TreeEntry[] =>
  entries.flatMap((entry) =>
    entry.kind === "file"
      ? [entry]
      : entry.children
        ? projectFiles(entry.children)
        : [],
  );
const emptyGit: GitState = {
  initialized: false,
  branch: "",
  branches: [],
  ahead: 0,
  behind: 0,
  remote: "",
  userName: "",
  userEmail: "",
  files: [],
  submodules: [],
  stashes: [],
  tags: [],
  commits: [],
};
const markdownPattern = /\.(?:md|markdown|mdown|mkd)$/i;
const prosePattern =
  /\.(?:md|markdown|mdown|mkd|txt|text|rst|rest|adoc|asciidoc|org|tex|log)$/i;
const isMarkdownFile = (name: string) => markdownPattern.test(name);
const isProseFile = (name: string) => prosePattern.test(name);
const editorChrome = (enabled: boolean) => ({
  minimap: {
    enabled,
    side: "right" as const,
    showSlider: "mouseover" as const,
    renderCharacters: false,
    maxColumn: 100,
    size: "fit" as const,
  },
  scrollbar: {
    vertical: "auto" as const,
    horizontal: "auto" as const,
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    verticalSliderSize: 6,
    horizontalSliderSize: 6,
    useShadows: false,
    alwaysConsumeMouseWheel: false,
  },
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
});
const gitHelpEntries = [
  [
    "Start a repository",
    "git init",
    "Create local version history in the current folder.",
  ],
  [
    "Copy a repository",
    "git clone <url>",
    "Download a repository and its history.",
  ],
  [
    "Status",
    "git status --short --branch",
    "Show the branch, changed files, and staging state.",
  ],
  ["Stage a file", "git add <file>", "Prepare one file for the next commit."],
  [
    "Stage everything",
    "git add -A",
    "Prepare every tracked and untracked change.",
  ],
  [
    "Unstage",
    "git restore --staged <file>",
    "Keep a file change but remove it from the next commit.",
  ],
  [
    "Discard a file change",
    "git restore <file>",
    "Restore a tracked file from the index.",
  ],
  ["Move a file", "git mv <old> <new>", "Move or rename a tracked file."],
  ["Remove a file", "git rm <file>", "Remove a file and stage the deletion."],
  ["Commit", 'git commit -m "message"', "Save staged changes locally."],
  ["Amend", "git commit --amend", "Replace the latest local commit."],
  [
    "History",
    "git log --oneline --graph --decorate",
    "Read compact branch history.",
  ],
  ["Show a commit", "git show <commit>", "Inspect a commit and its patch."],
  ["Working diff", "git diff", "Compare unstaged changes with the index."],
  [
    "Staged diff",
    "git diff --staged",
    "Compare staged changes with the latest commit.",
  ],
  [
    "File history",
    "git log --follow -- <file>",
    "Follow a file across renames.",
  ],
  [
    "Who changed a line",
    "git blame <file>",
    "Show the commit responsible for each line.",
  ],
  [
    "Search tracked text",
    'git grep "text"',
    "Search the checked-out repository.",
  ],
  ["Create branch", "git switch -c <name>", "Create and switch to a branch."],
  ["Switch branch", "git switch <name>", "Move to another local branch."],
  [
    "List branches",
    "git branch --all -vv",
    "Show local and remote branches with tracking details.",
  ],
  ["Rename branch", "git branch -m <new-name>", "Rename the current branch."],
  ["Delete branch", "git branch -d <name>", "Delete a merged local branch."],
  [
    "Detached checkout",
    "git switch --detach <commit>",
    "Inspect a commit without changing a branch.",
  ],
  [
    "Merge",
    "git merge <name>",
    "Merge another branch into the current branch.",
  ],
  [
    "Rebase",
    "git rebase <branch>",
    "Replay current commits on another branch.",
  ],
  [
    "Continue rebase",
    "git rebase --continue",
    "Continue after resolving a rebase conflict.",
  ],
  [
    "Abort rebase",
    "git rebase --abort",
    "Return to the state before the rebase.",
  ],
  [
    "Cherry-pick",
    "git cherry-pick <commit>",
    "Apply one existing commit to the current branch.",
  ],
  [
    "Revert",
    "git revert <commit>",
    "Create a new commit that reverses an earlier commit.",
  ],
  [
    "Reset index",
    "git reset <commit>",
    "Move HEAD and reset the index while keeping working files.",
  ],
  ["Recover reference", "git reflog", "Find recent branch and HEAD positions."],
  [
    "Stash",
    "git stash push -u -m <message>",
    "Temporarily store unfinished tracked and untracked changes.",
  ],
  ["List stashes", "git stash list", "Show saved work-in-progress entries."],
  ["Restore stash", "git stash pop", "Apply and remove the newest stash."],
  [
    "Tag",
    "git tag -a <name> -m <message>",
    "Create an annotated release marker.",
  ],
  [
    "Worktree",
    "git worktree add <path> <branch>",
    "Check out another branch in a second folder.",
  ],
  [
    "Remote",
    "git remote add origin <url>",
    "Link this local repository to a destination.",
  ],
  ["List remotes", "git remote -v", "Show remote names and destinations."],
  [
    "Change remote",
    "git remote set-url origin <url>",
    "Update the origin destination.",
  ],
  ["Fetch", "git fetch origin", "Download remote branch information."],
  ["Pull", "git pull", "Bring remote changes into the current branch."],
  ["Push", "git push -u origin HEAD", "Upload local commits."],
  [
    "Delete remote branch",
    "git push origin --delete <branch>",
    "Remove a branch from the remote.",
  ],
  [
    "Submodules",
    "git submodule status",
    "Show folders linked to separate repositories.",
  ],
  [
    "Update submodules",
    "git submodule update --init --recursive",
    "Initialize and update nested repositories.",
  ],
  [
    "Find a regression",
    "git bisect start",
    "Begin binary search for the commit that introduced a bug.",
  ],
  [
    "Remove untracked files",
    "git clean -nd",
    "Preview untracked files that would be removed; use -fd only after review.",
  ],
  [
    "Repository settings",
    "git config --local --list",
    "Show settings saved only for this repository.",
  ],
  [
    "Commit identity",
    "git config --local user.name <name>",
    "Set the local commit name; set user.email the same way.",
  ],
  [
    "Sparse checkout",
    "git sparse-checkout set <path>",
    "Check out only selected repository paths.",
  ],
  [
    "Create archive",
    "git archive -o project.zip HEAD",
    "Export tracked files without Git history.",
  ],
  [
    "Create bundle",
    "git bundle create repo.bundle --all",
    "Store repository history in one offline file.",
  ],
  [
    "Verify repository",
    "git fsck --full",
    "Check object connectivity and validity.",
  ],
  [
    "Maintenance",
    "git maintenance run",
    "Perform safe repository maintenance.",
  ],
  [
    "All installed commands",
    "git help -a",
    "List every command supported by the installed Git version.",
  ],
  [
    "Command manual",
    "git help <command>",
    "Open the complete manual for any installed command.",
  ],
] as const;
const uvHelpEntries = [
  ["Create an environment", "uv venv", "Create the project's .venv."],
  [
    "Choose Python",
    "uv venv --python 3.12",
    "Create .venv with a specific Python version.",
  ],
  [
    "Add a project dependency",
    "uv add requests",
    "Add a dependency to pyproject.toml, update uv.lock, and sync .venv.",
  ],
  [
    "Remove a project dependency",
    "uv remove requests",
    "Remove a dependency from pyproject.toml and sync the environment.",
  ],
  [
    "Install into the environment",
    "uv pip install requests",
    "Install directly into the active environment without editing project metadata.",
  ],
  [
    "List installed libraries",
    "uv pip list",
    "Show every package installed in the active environment.",
  ],
  [
    "Remove an installed library",
    "uv pip uninstall requests",
    "Uninstall one package from the active environment.",
  ],
  [
    "Check dependencies",
    "uv pip check",
    "Report missing or incompatible installed dependencies.",
  ],
  [
    "Run in the project",
    "uv run python app.py",
    "Run a command with the project's environment prepared and active.",
  ],
  [
    "Synchronize the project",
    "uv sync",
    "Make .venv match pyproject.toml and uv.lock.",
  ],
  [
    "Lock exact versions",
    "uv lock",
    "Resolve and record exact dependency versions in uv.lock.",
  ],
  [
    "Install a Python runtime",
    "uv python install 3.12",
    "Download a managed Python runtime.",
  ],
] as const;
const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error
    ? (() => {
        const message = error.message.replace(
          /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
          "",
        );
        if (/author identity unknown|please tell me who you are/i.test(message))
          return "Git could not prepare this repository for local commits.";
        if (/llama|backend init|access violation|0\.\d+\.\d+/i.test(message))
          return "The selected model could not start. Try the Small model or check the local AI engine.";
        return message.replace(/\s+/g, " ").slice(0, 360);
      })()
    : fallback;
export function App() {
  const [theme, setTheme] = useState<EditorPreferences["theme"]>("dark"),
    [advanced, setAdvanced] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [platformioOpen, setPlatformioOpen] = useState(false),
    [advancedSection, setAdvancedSection] = useState<
      "menu" | "debug" | "intelligence" | "runtimes" | "mcp"
    >("menu"),
    [project, setProject] = useState<ProjectState | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]),
    [activePath, setActivePath] = useState(""),
    [git, setGit] = useState(emptyGit),
    [gitOpen, setGitOpen] = useState(true),
    [remote, setRemote] = useState(""),
    [message, setMessage] = useState(""),
    [branchTarget, setBranchTarget] = useState(""),
    [branchName, setBranchName] = useState(""),
    [gitUtilityName, setGitUtilityName] = useState(""),
    [branchComposer, setBranchComposer] = useState(false),
    [notificationsOpen, setNotificationsOpen] = useState(false),
    [globalSearch, setGlobalSearch] = useState(""),
    [globalSearchOpen, setGlobalSearchOpen] = useState(false),
    [globalSearchResults, setGlobalSearchResults] = useState<{
      code: ProjectSearchResult[];
      chats: Array<{ id: string; title: string; preview: string }>;
    }>({ code: [], chats: [] }),
    [requestedAiChat, setRequestedAiChat] = useState(""),
    [pendingRevealLine, setPendingRevealLine] = useState(0),
    [gitHelpOpen, setGitHelpOpen] = useState(false),
    [gitHelpSearch, setGitHelpSearch] = useState(""),
    [detachedRef, setDetachedRef] = useState("");
  const [terminalOpen, setTerminalOpen] = useState(false),
    [terminalView, setTerminalView] = useState<"shell" | "run">("shell"),
    [shellTabs, setShellTabs] = useState(() => [
      {
        id: `shell-${globalThis.crypto.randomUUID()}`,
        title: "Shell 1",
        restart: 0,
      },
    ]),
    [activeShellId, setActiveShellId] = useState(""),
    [runtimes, setRuntimes] = useState<PythonRuntime[]>([]),
    [runtime, setRuntime] = useState(""),
    [pythonPackage, setPythonPackage] = useState(""),
    [pythonPackageSearch, setPythonPackageSearch] = useState(""),
    [pythonPackages, setPythonPackages] = useState<PythonPackage[]>([]),
    [pythonPackageEnvironment, setPythonPackageEnvironment] = useState(""),
    [pythonPackageLocation, setPythonPackageLocation] = useState<
      "" | "app" | "project"
    >(""),
    [pythonPackageManager, setPythonPackageManager] = useState<
      "" | "venv" | "conda"
    >(""),
    [pythonPackageError, setPythonPackageError] = useState(""),
    [packageOperation, setPackageOperation] = useState(""),
    [running, setRunning] = useState(false),
    [runOutput, setRunOutput] = useState(""),
    [runInput, setRunInput] = useState(""),
    [notice, setNotice] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [aiAttention, setAiAttention] = useState<AiAttention | null>(null);
  const [permissionCompletionReady, setPermissionCompletionReady] =
    useState(false);
  const [permissionCompleting, setPermissionCompleting] = useState(false);
  const permissionCompletionRef = useRef<(() => Promise<void>) | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [lastProject, setLastProject] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<TreeEntry | null>(null);
  const [projectClipboard, setProjectClipboard] =
    useState<ProjectClipboardState | null>(null);
  const [projectContextMenu, setProjectContextMenu] =
    useState<ProjectContextMenuState | null>(null);
  const [projectOperation, setProjectOperation] = useState<
    "file" | "folder" | "rename" | null
  >(null);
  const [projectItemName, setProjectItemName] = useState("");
  const [envName, setEnvName] = useState("");
  const [suggestions, setSuggestions] = useState(true),
    [wordWrap, setWordWrap] = useState(false),
    [proseWrap, setProseWrap] = useState(true),
    [minimap, setMinimap] = useState(true),
    [locale, setLocale] = useState<"en" | "ar">("en"),
    [sidebarSide, setSidebarSide] = useState<"left" | "right">("left"),
    [uiScale, setUiScale] = useState<1 | 1.15 | 1.3 | 1.5 | 1.7>(1),
    [editorFontSize, setEditorFontSize] = useState(14),
    [sidebarWidth, setSidebarWidth] = useState(520),
    [gitHeight, setGitHeight] = useState(390),
    [aiPanelWidth, setAiPanelWidth] = useState(560),
    [sidebarVisible, setSidebarVisible] = useState(true),
    [aiVisible, setAiVisible] = useState(false),
    [markdownView, setMarkdownView] = useState<"edit" | "split" | "preview">(
      "split",
    ),
    [editorView, setEditorView] = useState<"single" | "split" | "compare">(
      "single",
    ),
    [splitLeftPath, setSplitLeftPath] = useState(""),
    [splitRightPath, setSplitRightPath] = useState(""),
    [compareOpen, setCompareOpen] = useState(false),
    [compareLeftPath, setCompareLeftPath] = useState(""),
    [compareRightPath, setCompareRightPath] = useState(""),
    [comparison, setComparison] = useState<FileComparison | null>(null),
    [aiEngine, setAiEngine] = useState<AiEngine>("llamacpp"),
    [aiModel, setAiModel] = useState(""),
    [aiExecutable, setAiExecutable] = useState(""),
    [aiEditMode, setAiEditMode] = useState<AiEditMode>("ask"),
    [aiTerminalMode, setAiTerminalMode] = useState<AiTerminalMode>("ask"),
    [aiFileAccess, setAiFileAccess] = useState(false),
    [aiWebAccess, setAiWebAccess] = useState(false),
    [aiBrowserAccess, setAiBrowserAccess] = useState(false),
    [aiComputerAccess, setAiComputerAccess] = useState(false),
    [aiContextLimit, setAiContextLimit] = useState(262144),
    [aiHardware, setAiHardware] = useState<AiInferenceHardware>("auto"),
    [aiThinkingEnabled, setAiThinkingEnabled] = useState(true),
    [spellcheck, setSpellcheck] = useState(true),
    [autoSave, setAutoSave] = useState(true),
    [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false),
    [autoUpdatePromptAnswered, setAutoUpdatePromptAnswered] = useState(false),
    [autoUpdateDismissedVersion, setAutoUpdateDismissedVersion] = useState(""),
    [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>({
      state: "disabled",
      message: "Automatic updates are off",
      currentVersion: "",
    }),
    [pythonManagerOpen, setPythonManagerOpen] = useState(false),
    [uvHelpOpen, setUvHelpOpen] = useState(false),
    [uvHelpSearch, setUvHelpSearch] = useState(""),
    [installing, setInstalling] = useState(""),
    [activity, setActivity] = useState<AgentActivity | null>(null),
    [browserActivity, setBrowserActivity] = useState<AgentActivity | null>(
      null,
    ),
    [browserViewOpen, setBrowserViewOpen] = useState(false),
    [browserSnapshot, setBrowserSnapshot] =
      useState<AgentBrowserSnapshot | null>(null),
    [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null),
    [commitBranchName, setCommitBranchName] = useState(""),
    [commitTagName, setCommitTagName] = useState(""),
    [saveHistoryOpen, setSaveHistoryOpen] = useState(false),
    [saveHistory, setSaveHistory] = useState<SaveHistoryEntry[]>([]),
    [saveHistoryLoading, setSaveHistoryLoading] = useState(false),
    [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]),
    [mcpName, setMcpName] = useState(""),
    [mcpCommand, setMcpCommand] = useState(""),
    [mcpArgs, setMcpArgs] = useState("");
  const [, setMonacoReady] = useState(false);
  const monacoRef = useRef<
    typeof import("monaco-editor/editor/editor.api") | null
  >(null);
  const editorRef = useRef<
    | import("monaco-editor/editor/editor.api").editor.IStandaloneCodeEditor
    | null
  >(null);
  const editorTabsRef = useRef<HTMLDivElement | null>(null);
  const shellSequenceRef = useRef(1);
  const projectPickerOpen = useRef(false);
  const savingPaths = useRef(new Set<string>());
  const externalConflictPaths = useRef(new Set<string>());
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;
  const menuActions = useRef<Record<string, () => void>>({});
  const autoUpdateEnabledRef = useRef(false);
  const autoUpdateDismissedVersionRef = useRef("");
  const shortcutModifier = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";
  const active = tabs.find((t) => t.path === activePath);
  const textTabs = tabs.filter((tab) => !tab.media);
  const splitLeftTab =
    textTabs.find((tab) => tab.path === splitLeftPath) ||
    (active?.media ? undefined : active) ||
    textTabs[0];
  const splitRightTab =
    textTabs.find((tab) => tab.path === splitRightPath) ||
    textTabs.find((tab) => tab.path !== splitLeftTab?.path) ||
    splitLeftTab;
  const dirty = active && !active.media && active.content !== active.saved;
  const hasDirtyTabs = tabs.some(
    (tab) => !tab.media && tab.content !== tab.saved,
  );
  const selectedRuntime = runtimes.find((x) => x.path === runtime);
  const appRuntime =
    runtimes.find(
      (item) =>
        item.scope === "app" && item.version === "3.12" && item.installed,
    ) || runtimes.find((item) => item.scope === "app" && item.installed);
  const projectEnvironment =
    selectedRuntime?.scope === "project" ||
    selectedRuntime?.scope === "app-project";
  const pythonProject = Boolean(
    project?.tree.some(
      (entry) =>
        entry.kind === "file" &&
        [
          "pyproject.toml",
          "requirements.txt",
          "pipfile",
          "setup.py",
          ".python-version",
          "poetry.lock",
          "pipfile.lock",
          "environment.yml",
          "environment.yaml",
          "conda-lock.yml",
        ].includes(entry.name.toLowerCase()),
    ),
  );
  const pythonContext =
    active?.name.toLowerCase().endsWith(".py") || pythonProject;
  useEffect(() => {
    document.addEventListener("wheel", scrollHorizontalMenu, {
      capture: true,
      passive: false,
    });
    return () =>
      document.removeEventListener("wheel", scrollHorizontalMenu, true);
  }, []);
  useEffect(() => {
    if (!projectContextMenu) return;
    const close = () => setProjectContextMenu(null);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    document.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", key);
    };
  }, [projectContextMenu]);
  useEffect(() => {
    if (!pythonContext && terminalView !== "shell") setTerminalView("shell");
  }, [pythonContext, terminalView]);
  const aiPanelSide = sidebarSide === "left" ? "right" : "left";
  const activeTerminalId = activeShellId || shellTabs[0]?.id || "";
  useEffect(() => {
    if (!activeShellId && shellTabs[0]) setActiveShellId(shellTabs[0].id);
  }, [activeShellId, shellTabs]);
  useEffect(() => {
    setBranchTarget(git.branch);
  }, [project?.root, git.branch]);
  useEffect(() => {
    return window.oscode.onMenuAction((action) =>
      menuActions.current[action]?.(),
    );
  }, []);
  useEffect(() => {
    if (window.oscode.platform !== "darwin") return;
    void window.oscode.setTouchBarState({
      editable: Boolean(active && !active.media),
      dirty: Boolean(dirty),
      canRun: Boolean(
        active?.name.toLowerCase().endsWith(".py") && runtime && !running,
      ),
      running,
      terminalOpen,
      aiOpen: aiVisible,
    });
  }, [active, aiVisible, dirty, running, runtime, terminalOpen]);
  useEffect(
    () =>
      window.oscode.onPreferencesChanged((preferences) => {
        if (!preferencesReady) return;
        setTheme(preferences.theme);
        setLocale(preferences.locale);
        setSidebarSide(preferences.sidebarSide);
        setUiScale(preferences.uiScale);
        setEditorFontSize(preferences.editorFontSize);
        setAiPanelWidth(preferences.aiPanelWidth);
        setAiEngine(preferences.aiEngine);
        setAiModel(preferences.aiModel);
        setAiExecutable(preferences.aiExecutable);
        setAiContextLimit(preferences.aiContextLimit);
        setAiHardware(preferences.aiHardware);
        setAiThinkingEnabled(preferences.aiThinkingEnabled);
        setAutoSave(preferences.autoSave);
      }),
    [preferencesReady],
  );
  useEffect(() => {
    autoUpdateEnabledRef.current = autoUpdateEnabled;
    autoUpdateDismissedVersionRef.current = autoUpdateDismissedVersion;
  }, [autoUpdateEnabled, autoUpdateDismissedVersion]);
  useEffect(() => {
    void window.oscode.appUpdateStatus().then(setUpdateStatus);
    return window.oscode.onAppUpdateStatus((status) => {
      setUpdateStatus(status);
      if (["checking", "downloading"].includes(status.state)) {
        setActivity({
          kind: "download",
          label: status.message,
          active: true,
          network: true,
          progress: status.percent,
          cancellable: false,
        });
        return;
      }
      setActivity((current) =>
        current?.kind === "download" &&
        /osCode|GitHub|update/i.test(current.label)
          ? null
          : current,
      );
      const updateReminder =
        (status.state === "ready" ||
          (status.state === "available" && !autoUpdateEnabledRef.current)) &&
        status.version &&
        status.version !== autoUpdateDismissedVersionRef.current;
      if (updateReminder || status.state === "error")
        setNotifications((current) => {
          const id = `app-update-${status.state}-${status.version || "current"}`;
          const notification: AppNotification = {
            id,
            kind: updateReminder ? "app-update" : "message",
            message: status.message,
            createdAt: Date.now(),
          };
          if (current.some((item) => item.id === id))
            return current.map((item) =>
              item.id === id ? notification : item,
            );
          return [
            ...(updateReminder
              ? current.filter((item) => item.kind !== "app-update")
              : current
            ).slice(-39),
            notification,
          ];
        });
      if (updateReminder) setNotificationsOpen(true);
    });
  }, []);
  useEffect(() => {
    void window.oscode.setAppAttentionBadge(
      aiAttention ? 1 : 0,
      aiAttention?.kind || "response",
    );
  }, [aiAttention]);
  useEffect(() => {
    const offState = window.oscode.onPlatformioState((state) => {
      if (!state.running)
        setActivity((current) =>
          current?.kind === "platformio" ? null : current,
        );
    });
    const offAi = window.oscode.onAiStatus((message) => {
      if (/searching the web|public web page|pulling|installing/i.test(message))
        setActivity({
          kind: "network",
          label: message.replace(/…/g, ""),
          active: true,
          network: true,
          cancellable: true,
        });
      else if (
        /ready|stopped|thinking|loading the selected model|answering|processing/i.test(
          message,
        )
      )
        setActivity((current) =>
          current && current.kind === "network" ? null : current,
        );
    });
    const offAgent = window.oscode.onAgentActivity((next) => {
      if (next.kind === "browser") {
        setBrowserActivity(next.active ? next : null);
      }
      if (next.active) {
        setActivity(next);
        if (
          next.kind === "security" ||
          (next.kind === "queue" && /queued|another project/i.test(next.label))
        ) {
          setNotifications((current) => [
            ...current.slice(-39),
            {
              id: crypto.randomUUID(),
              message: next.label,
              createdAt: Date.now(),
            },
          ]);
          setNotificationsOpen(true);
        }
      } else
        setActivity((current) =>
          current?.kind === next.kind ? null : current,
        );
    });
    return () => {
      offState();
      offAi();
      offAgent();
    };
  }, []);
  useEffect(() => {
    if (!browserViewOpen && activePath === agentBrowserTabPath)
      setActivePath(tabs.at(-1)?.path || "");
  }, [activePath, browserViewOpen, tabs]);
  useEffect(() => {
    if (!tabs.length) {
      setSplitLeftPath("");
      setSplitRightPath("");
      return;
    }
    const fallbackLeft =
      tabs.find((tab) => tab.path === activePath)?.path || tabs[0].path;
    setSplitLeftPath((current) =>
      tabs.some((tab) => tab.path === current) ? current : fallbackLeft,
    );
    setSplitRightPath((current) =>
      tabs.some((tab) => tab.path === current)
        ? current
        : tabs.find((tab) => tab.path !== fallbackLeft)?.path || fallbackLeft,
    );
  }, [activePath, tabs]);
  useEffect(() => {
    if (!browserViewOpen) return;
    let cancelled = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const snapshot = await window.oscode.agentBrowserSnapshot();
        if (!cancelled && snapshot) setBrowserSnapshot(snapshot);
      } catch {
        // The browser may close between an activity event and a capture.
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [browserViewOpen]);
  useEffect(() => {
    window.oscode.setDirtyState(hasDirtyTabs);
  }, [hasDirtyTabs]);
  useEffect(() => {
    const a = window.oscode.onRunData((x) => {
      setTerminalOpen(true);
      setTerminalView("run");
      setRunOutput((current) => current + x);
      setRunning(true);
    });
    const b = window.oscode.onRunStopped(() => {
      setRunning(false);
      setRunInput("");
    });
    return () => {
      a();
      b();
    };
  }, []);
  useEffect(() => {
    setNotice("");
    setSaveHistoryOpen(false);
  }, [activePath]);
  useEffect(() => {
    if (!notice) return;
    setNotifications((current) => [
      ...current.slice(-39),
      { id: crypto.randomUUID(), message: notice, createdAt: Date.now() },
    ]);
    const timeout = window.setTimeout(
      () => setNotice(""),
      NOTICE_AUTO_DISMISS_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);
  useEffect(() => window.oscode.setZoomFactor(uiScale), [uiScale]);
  useEffect(() => {
    void window.oscode.setSpellcheck(spellcheck);
  }, [spellcheck]);
  useEffect(
    () =>
      window.oscode.onSpellcheckReplaceAll((word, replacement) => {
        const editor = editorRef.current;
        const model = editor?.getModel();
        if (!editor || !model || !word) return;
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const matches = model.findMatches(
          `\\b${escaped}\\b`,
          true,
          true,
          true,
          null,
          false,
        );
        if (!matches.length) return;
        editor.executeEdits(
          "spellcheck.replace-all",
          matches.map((match) => ({
            range: match.range,
            text: replacement,
            forceMoveMarkers: true,
          })),
        );
      }),
    [],
  );
  useEffect(() => {
    if (!pythonContext && terminalView === "run") setTerminalView("shell");
  }, [pythonContext, terminalView]);
  const activateProject = async (nextProject: ProjectState) => {
    await window.oscode.stopAgentControl();
    setAiEditMode("ask");
    setAiTerminalMode("ask");
    setAiFileAccess(false);
    setAiWebAccess(false);
    setAiBrowserAccess(false);
    setAiComputerAccess(false);
    setBrowserActivity(null);
    setBrowserViewOpen(false);
    setBrowserSnapshot(null);
    setProject(nextProject);
    setSelectedEntry(null);
    setProjectClipboard(null);
    setProjectContextMenu(null);
    setProjectOperation(null);
    setTabs([]);
    setActivePath("");
    setComparison(null);
    setCompareOpen(false);
    setTerminalOpen(false);
    setRunning(false);
    setPythonManagerOpen(false);
    setUvHelpOpen(false);
    setPythonPackages([]);
    setPythonPackageEnvironment("");
    setPythonPackageManager("");
    setPythonPackageError("");
    setPathInput(nextProject.root);
    setLastProject(nextProject.root);
    const state = await window.oscode.gitState();
    setGit(state);
    setRemote(state.remote);
    await refreshRuntimes(true);
  };
  const confirmProjectChange = (action: string) =>
    !hasDirtyTabs ||
    window.oscode.confirmDiscardChanges(
      `${action} will discard changes in every unsaved tab.`,
    );
  const openProject = async () => {
    if (projectPickerOpen.current) return;
    projectPickerOpen.current = true;
    try {
      if (!(await confirmProjectChange("Opening another project"))) return;
      const p = await window.oscode.openProject();
      if (p) await activateProject(p);
    } catch (e) {
      setNotice(errorMessage(e, "Project could not open"));
    } finally {
      projectPickerOpen.current = false;
    }
  };
  const createProject = async () => {
    if (projectPickerOpen.current) return;
    projectPickerOpen.current = true;
    try {
      if (!(await confirmProjectChange("Creating another project"))) return;
      const created = await window.oscode.createProject();
      if (created) {
        await activateProject(created);
        setNotice(`Created ${created.name}`);
      }
    } catch (e) {
      setNotice(errorMessage(e, "Project folder could not be created"));
    } finally {
      projectPickerOpen.current = false;
    }
  };
  const openProjectPath = async () => {
    if (!pathInput.trim()) return;
    try {
      if (!(await confirmProjectChange("Opening another project"))) return;
      const p = await window.oscode.openProjectPath(pathInput);
      await activateProject(p);
    } catch (e) {
      setNotice(errorMessage(e, "Could not open that folder"));
    }
  };
  const openFile = async (e: TreeEntry) => {
    const existing = tabs.find((t) => t.path === e.path);
    if (existing) {
      setActivePath(e.path);
      return;
    }
    try {
      const opened = await window.oscode.openProjectFile(e.path);
      setTabs((x) => [
        ...x,
        opened.kind === "media"
          ? {
              path: e.path,
              name: e.name,
              content: "",
              saved: "",
              media: opened.media,
            }
          : {
              path: e.path,
              name: e.name,
              content: opened.content,
              saved: opened.content,
            },
      ]);
      if (opened.kind === "media") setEditorView("single");
      setActivePath(e.path);
    } catch (error) {
      setNotice(errorMessage(error, "This file cannot be opened"));
    }
  };
  const toggleSplitView = () => {
    if (!active || active.media) return;
    if (editorView === "split") {
      setEditorView("single");
      return;
    }
    setSplitLeftPath(active.path);
    setSplitRightPath((current) =>
      textTabs.some((tab) => tab.path === current && current !== active.path)
        ? current
        : textTabs.find((tab) => tab.path !== active.path)?.path || active.path,
    );
    setEditorView("split");
  };
  const openCompare = () => {
    if (!project || !active) return;
    const files = projectFiles(project.tree);
    setCompareLeftPath(active.path);
    setCompareRightPath(
      comparison?.rightPath ||
        files.find((entry) => entry.path !== active.path)?.path ||
        "",
    );
    setCompareOpen(true);
  };
  const startComparison = async () => {
    if (!project || !compareLeftPath || !compareRightPath) return;
    const files = projectFiles(project.tree);
    const left = files.find((entry) => entry.path === compareLeftPath);
    const right = files.find((entry) => entry.path === compareRightPath);
    if (!left || !right) return;
    try {
      const content = async (entry: TreeEntry) =>
        tabs.find((tab) => tab.path === entry.path)?.content ??
        (await window.oscode.readFile(entry.path));
      const [leftContent, rightContent] = await Promise.all([
        content(left),
        content(right),
      ]);
      setComparison({
        leftPath: left.path,
        leftName: left.name,
        leftContent,
        rightPath: right.path,
        rightName: right.name,
        rightContent,
      });
      setEditorView("compare");
      setCompareOpen(false);
    } catch (error) {
      setNotice(errorMessage(error, "Those files could not be compared"));
    }
  };
  useEffect(() => {
    const query = globalSearch.trim();
    if (!query || !project) {
      setGlobalSearchResults({ code: [], chats: [] });
      return;
    }
    let current = true;
    const timeout = window.setTimeout(() => {
      void Promise.all([
        window.oscode.searchProject(query),
        window.oscode.aiAgentState(),
      ])
        .then(([code, state]) => {
          if (!current) return;
          const needle = query.toLowerCase();
          const chats = state.chats
            .slice()
            .sort(
              (left, right) =>
                Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
            )
            .filter((chat) =>
              `${chat.title} ${chat.messages.map((item) => item.content).join(" ")}`
                .toLowerCase()
                .includes(needle),
            )
            .slice(0, 20)
            .map((chat) => {
              const match = chat.messages.find((item) =>
                item.content.toLowerCase().includes(needle),
              );
              return {
                id: chat.id,
                title: chat.title,
                preview: chatSearchPreview(
                  match?.content || "Chat title match",
                ).slice(0, 180),
              };
            });
          setGlobalSearchResults({ code: code.slice(0, 80), chats });
        })
        .catch((error) => {
          if (current) setNotice(errorMessage(error, "Search failed"));
        });
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [globalSearch, project?.root]);
  const openGlobalProjectSearch = () => {
    if (!project) {
      setNotice("Open a project before searching");
      return;
    }
    setGlobalSearchOpen(true);
  };
  const expandDirectory = async (target: string) => {
    const children = await window.oscode.listDirectory(target);
    const update = (entries: TreeEntry[]): TreeEntry[] =>
      entries.map((entry) =>
        entry.path === target
          ? { ...entry, children }
          : entry.children
            ? { ...entry, children: update(entry.children) }
            : entry,
      );
    setProject((current) =>
      current ? { ...current, tree: update(current.tree) } : current,
    );
  };
  const refreshProjectItems = async () => {
    if (!project) return;
    try {
      const tree = await window.oscode.refreshProject();
      setProject((current) => (current ? { ...current, tree } : current));
      setSelectedEntry(null);
      setNotice("Project refreshed");
    } catch (e) {
      setNotice(errorMessage(e, "Project could not refresh"));
    }
  };
  const closeProject = async () => {
    if (!(await confirmProjectChange("Closing this project"))) return;
    try {
      await window.oscode.closeProject();
    } catch (e) {
      setNotice(errorMessage(e, "Project could not close"));
      return;
    }
    setProject(null);
    await window.oscode.stopAgentControl();
    setAiEditMode("ask");
    setAiTerminalMode("ask");
    setAiFileAccess(false);
    setAiWebAccess(false);
    setAiBrowserAccess(false);
    setAiComputerAccess(false);
    setLastProject("");
    setPathInput("");
    setSelectedEntry(null);
    setProjectClipboard(null);
    setProjectContextMenu(null);
    setProjectOperation(null);
    setTabs([]);
    setActivePath("");
    setEditorView("single");
    setSplitLeftPath("");
    setSplitRightPath("");
    setComparison(null);
    setCompareOpen(false);
    setTerminalOpen(false);
    setRunning(false);
    setGit(emptyGit);
    setRemote("");
    await refreshRuntimes();
    setNotice("Project closed and removed from startup");
  };
  const closeTab = async (path: string) => {
    const closing = tabsRef.current.find((tab) => tab.path === path);
    if (!closing) return;
    if (
      closing.content !== closing.saved &&
      !(await window.oscode.confirmDiscardChanges(
        `Closing “${closing.name}” will discard its unsaved changes.`,
      ))
    )
      return;
    const currentTabs = tabsRef.current;
    const closingIndex = currentTabs.findIndex((tab) => tab.path === path);
    const remaining = currentTabs.filter((tab) => tab.path !== path);
    setTabs(remaining);
    setActivePath((current) => {
      if (current !== path) return current;
      return (
        remaining[Math.min(closingIndex, remaining.length - 1)]?.path || ""
      );
    });
  };
  const beginProjectOperation = (operation: "file" | "folder" | "rename") => {
    if (operation === "rename" && !selectedEntry) return;
    setProjectOperation(operation);
    setProjectItemName(operation === "rename" ? selectedEntry?.name || "" : "");
  };
  const entryContains = (root: string, candidate: string) =>
    candidate === root ||
    candidate.startsWith(`${root}\\`) ||
    candidate.startsWith(`${root}/`);
  const applyProjectOperation = async () => {
    if (!project || !projectOperation || !projectItemName.trim()) return;
    try {
      if (projectOperation === "rename" && selectedEntry) {
        const oldPath = selectedEntry.path;
        const result = await window.oscode.renameProjectItem(
          oldPath,
          projectItemName,
        );
        const updatePath = (candidate: string) =>
          entryContains(oldPath, candidate)
            ? result.newPath + candidate.slice(oldPath.length)
            : candidate;
        setProject({ ...project, tree: result.tree });
        setTabs((current) =>
          current.map((tab) => ({
            ...tab,
            path: updatePath(tab.path),
            name: tab.path === oldPath ? result.name : tab.name,
          })),
        );
        setActivePath((current) => updatePath(current));
        setSelectedEntry({
          ...selectedEntry,
          name: result.name,
          path: result.newPath,
        });
        setNotice(`Renamed to ${result.name}`);
      } else if (projectOperation === "file" || projectOperation === "folder") {
        const directory =
          selectedEntry?.kind === "directory"
            ? selectedEntry.path
            : project.root;
        const result = await window.oscode.createProjectItem(
          directory,
          projectItemName,
          projectOperation,
        );
        setProject({ ...project, tree: result.tree });
        setSelectedEntry(result.item);
        if (result.item.kind === "file") await openFile(result.item);
        setNotice(`${projectOperation === "file" ? "File" : "Folder"} created`);
      }
      setProjectOperation(null);
      setProjectItemName("");
      const state = await window.oscode.gitState();
      setGit(state);
      setRemote(state.remote);
    } catch (e) {
      setNotice(errorMessage(e, "Project item could not change"));
    }
  };
  const trashEntry = async (entry: TreeEntry) => {
    if (!project) return;
    try {
      const removedPath = entry.path;
      const hasUnsavedChanges = tabs.some(
        (tab) =>
          !tab.media &&
          entryContains(removedPath, tab.path) &&
          tab.content !== tab.saved,
      );
      const result = await window.oscode.trashProjectItem(
        removedPath,
        hasUnsavedChanges,
      );
      if (!result.deleted) return;
      setProject({ ...project, tree: result.tree });
      setTabs((current) =>
        current.filter((tab) => !entryContains(removedPath, tab.path)),
      );
      setActivePath((current) =>
        entryContains(removedPath, current) ? "" : current,
      );
      setSelectedEntry(null);
      setProjectOperation(null);
      setNotice(
        `Moved to ${/Win/i.test(navigator.platform) ? "Recycle Bin" : "Trash"}`,
      );
      const state = await window.oscode.gitState();
      setGit(state);
      setRemote(state.remote);
    } catch (e) {
      setNotice(errorMessage(e, "Project item could not be removed"));
    }
  };
  const trashSelectedEntry = async () => {
    if (selectedEntry) await trashEntry(selectedEntry);
  };
  const saveTab = async (
    tab: Tab,
    source: "manual" | "autosave" = "manual",
    announce = source === "manual",
  ) => {
    if (tab.media) return true;
    if (savingPaths.current.has(tab.path)) return false;
    savingPaths.current.add(tab.path);
    try {
      await window.oscode.writeFile(tab.path, tab.content, source);
      setTabs((x) =>
        x.map((current) =>
          current.path === tab.path && current.content === tab.content
            ? { ...current, saved: tab.content }
            : current,
        ),
      );
      externalConflictPaths.current.delete(tab.path);
      if (announce) setNotice("Saved");
      return true;
    } catch (e) {
      setNotice(errorMessage(e, "File could not be saved"));
      return false;
    } finally {
      savingPaths.current.delete(tab.path);
    }
  };
  const save = async () => (active ? saveTab(active) : false);
  const saveAll = async () => {
    const pending = tabsRef.current.filter(
      (tab) => !tab.media && tab.content !== tab.saved,
    );
    if (!pending.length) {
      setNotice("Every open file is already saved");
      return true;
    }
    const results = [];
    for (const tab of pending)
      results.push(await saveTab(tab, "manual", false));
    const complete = results.every(Boolean);
    setNotice(
      complete
        ? `Saved ${pending.length} ${pending.length === 1 ? "file" : "files"}`
        : "Some files could not be saved",
    );
    return complete;
  };
  const entryForTab = (tab: Tab): TreeEntry => ({
    name: tab.name,
    path: tab.path,
    kind: "file",
  });
  const commandEntry = () =>
    selectedEntry || (active ? entryForTab(active) : null);
  const parentPath = (target: string) => {
    const separator = Math.max(
      target.lastIndexOf("/"),
      target.lastIndexOf("\\"),
    );
    return separator > 0 ? target.slice(0, separator) : project?.root || "";
  };
  const showProjectContextMenu = (
    source: ProjectContextMenuState["source"],
    event: ReactMouseEvent,
    entry?: TreeEntry,
    tabPath?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (entry) setSelectedEntry(entry);
    if (tabPath) setActivePath(tabPath);
    const menuWidth = 272;
    const menuHeight = Math.min(560, window.innerHeight - 24);
    setProjectContextMenu({
      x: Math.max(
        12,
        Math.min(event.clientX, window.innerWidth - menuWidth - 12),
      ),
      y: Math.max(
        12,
        Math.min(event.clientY, window.innerHeight - menuHeight - 12),
      ),
      source,
      entry,
      tabPath,
    });
  };
  const renameEntry = (entry: TreeEntry) => {
    setSelectedEntry(entry);
    setProjectOperation("rename");
    setProjectItemName(entry.name);
  };
  const closeTabSet = async (paths: string[], description: string) => {
    const targets = new Set(paths);
    if (!targets.size) return true;
    const current = tabsRef.current;
    const unsaved = current.filter(
      (tab) => targets.has(tab.path) && !tab.media && tab.content !== tab.saved,
    );
    if (
      unsaved.length &&
      !(await window.oscode.confirmDiscardChanges(
        `${description} will discard changes in ${unsaved.length} unsaved ${unsaved.length === 1 ? "file" : "files"}.`,
      ))
    )
      return false;
    const remaining = current.filter((tab) => !targets.has(tab.path));
    const activeIndex = current.findIndex((tab) => tab.path === activePath);
    setTabs(remaining);
    if (targets.has(activePath))
      setActivePath(
        remaining[Math.min(Math.max(0, activeIndex), remaining.length - 1)]
          ?.path || "",
      );
    return true;
  };
  const saveEntryAs = async (entry: TreeEntry) => {
    if (!project || entry.kind !== "file") return;
    try {
      const open = tabsRef.current.find((tab) => tab.path === entry.path);
      let content: string | undefined;
      if (open) content = open.media ? undefined : open.content;
      else
        content = await window.oscode
          .readFile(entry.path)
          .catch(() => undefined);
      const result = await window.oscode.saveFileAs(entry.path, content);
      if (!result) return;
      setProject({ ...project, tree: result.tree });
      setTabs((current) => {
        if (open)
          return current
            .filter(
              (tab) => tab.path !== result.newPath || tab.path === entry.path,
            )
            .map((tab) =>
              tab.path === entry.path
                ? {
                    ...tab,
                    path: result.newPath,
                    name: result.name,
                    ...(content === undefined
                      ? {}
                      : { content, saved: content }),
                  }
                : tab,
            );
        if (current.some((tab) => tab.path === result.newPath))
          return current.map((tab) =>
            tab.path === result.newPath
              ? {
                  ...tab,
                  name: result.name,
                  ...(content === undefined ? {} : { content, saved: content }),
                }
              : tab,
          );
        if (content === undefined) return current;
        return [
          ...current,
          {
            path: result.newPath,
            name: result.name,
            content,
            saved: content,
          },
        ];
      });
      setActivePath(result.newPath);
      setSelectedEntry({
        name: result.name,
        path: result.newPath,
        kind: "file",
      });
      if (!open && content === undefined)
        await openFile({
          name: result.name,
          path: result.newPath,
          kind: "file",
        });
      setNotice(`Saved as ${result.name}`);
    } catch (error) {
      setNotice(errorMessage(error, "File could not be saved as a new file"));
    }
  };
  const revertEntry = async (entry: TreeEntry) => {
    const tab = tabsRef.current.find((item) => item.path === entry.path);
    if (!tab || tab.media) return;
    if (
      tab.content !== tab.saved &&
      !(await window.oscode.confirmDiscardChanges(
        `Reverting “${tab.name}” will discard its unsaved editor changes.`,
      ))
    )
      return;
    try {
      const content = await window.oscode.readFile(tab.path);
      setTabs((current) =>
        current.map((item) =>
          item.path === tab.path ? { ...item, content, saved: content } : item,
        ),
      );
      externalConflictPaths.current.delete(tab.path);
      setNotice(`${tab.name} reverted from disk`);
    } catch (error) {
      setNotice(errorMessage(error, "File could not be reverted"));
    }
  };
  const duplicateEntry = async (entry: TreeEntry) => {
    if (!project) return;
    try {
      const open = tabsRef.current.find((tab) => tab.path === entry.path);
      const result = await window.oscode.duplicateProjectItem(
        entry.path,
        open && !open.media ? open.content : undefined,
      );
      setProject({ ...project, tree: result.tree });
      setSelectedEntry(result.item);
      if (result.item.kind === "file") await openFile(result.item);
      setNotice(`Duplicated as ${result.name}`);
    } catch (error) {
      setNotice(errorMessage(error, "Project item could not be duplicated"));
    }
  };
  const transferEntry = async (
    entry: TreeEntry,
    mode: "copy" | "move",
    destination?: string,
  ) => {
    if (!project) return;
    try {
      const targetDirectory =
        destination || (await window.oscode.chooseProjectDirectory(entry.path));
      if (!targetDirectory) return;
      if (mode === "move" && parentPath(entry.path) === targetDirectory) {
        setNotice(`${entry.name} is already in that folder`);
        return;
      }
      const result = await window.oscode.transferProjectItem(
        entry.path,
        targetDirectory,
        mode,
      );
      setProject({ ...project, tree: result.tree });
      setSelectedEntry(result.item);
      if (mode === "move") {
        const updatePath = (candidate: string) =>
          entryContains(entry.path, candidate)
            ? result.newPath + candidate.slice(entry.path.length)
            : candidate;
        setTabs((current) =>
          current.map((tab) => ({
            ...tab,
            path: updatePath(tab.path),
            name: tab.path === entry.path ? result.name : tab.name,
          })),
        );
        setActivePath((current) => updatePath(current));
      } else if (result.item.kind === "file") await openFile(result.item);
      setNotice(`${mode === "move" ? "Moved" : "Copied"} ${entry.name}`);
      const state = await window.oscode.gitState();
      setGit(state);
      setRemote(state.remote);
    } catch (error) {
      setNotice(
        errorMessage(
          error,
          `Project item could not be ${mode === "move" ? "moved" : "copied"}`,
        ),
      );
    }
  };
  const rememberProjectClipboard = (
    entry: TreeEntry,
    mode: ProjectClipboardState["mode"],
  ) => {
    setProjectClipboard({
      path: entry.path,
      mode,
      name: entry.name,
      kind: entry.kind,
    });
    setNotice(`${mode === "move" ? "Cut" : "Copied"} ${entry.name}`);
  };
  const pasteProjectClipboard = async (entry?: TreeEntry) => {
    if (!projectClipboard || !project) return;
    const destination =
      entry?.kind === "directory"
        ? entry.path
        : entry
          ? parentPath(entry.path)
          : project.root;
    const sourceEntry: TreeEntry = {
      name: projectClipboard.name,
      path: projectClipboard.path,
      kind: projectClipboard.kind,
    };
    await transferEntry(sourceEntry, projectClipboard.mode, destination);
    if (projectClipboard.mode === "move") setProjectClipboard(null);
  };
  const copyEntryPath = async (entry: TreeEntry, relative: boolean) => {
    try {
      await window.oscode.copyProjectPath(entry.path, relative);
      setNotice(relative ? "Relative path copied" : "Full path copied");
    } catch (error) {
      setNotice(errorMessage(error, "Path could not be copied"));
    }
  };
  const revealEntry = async (entry: TreeEntry) => {
    try {
      await window.oscode.revealProjectItem(entry.path);
    } catch (error) {
      setNotice(errorMessage(error, "Project item could not be revealed"));
    }
  };
  const openEntryToSide = async (entry: TreeEntry) => {
    if (entry.kind !== "file") return;
    const previous = active?.media ? "" : active?.path || "";
    await openFile(entry);
    setSplitLeftPath(previous || entry.path);
    setSplitRightPath(entry.path);
    setEditorView("split");
  };
  const refreshMcpServers = async () => {
    try {
      setMcpServers(await window.oscode.listMcpServers());
    } catch (error) {
      setNotice(errorMessage(error, "Could not load MCP servers"));
    }
  };
  const saveMcpServer = async () => {
    try {
      await window.oscode.saveMcpServer({
        name: mcpName,
        command: mcpCommand,
        args: mcpArgs
          .split(/\r?\n/)
          .map((argument) => argument.trim())
          .filter(Boolean),
        enabled: true,
      });
      setMcpName("");
      setMcpCommand("");
      setMcpArgs("");
      await refreshMcpServers();
      setNotice("MCP server saved in encrypted app storage");
    } catch (error) {
      setNotice(errorMessage(error, "Could not save MCP server"));
    }
  };
  const updateMcpServer = async (server: McpServerConfig, enabled: boolean) => {
    try {
      await window.oscode.saveMcpServer({ ...server, enabled });
      await refreshMcpServers();
    } catch (error) {
      setNotice(errorMessage(error, "Could not update MCP server"));
    }
  };
  const removeMcpServer = async (id: string) => {
    try {
      await window.oscode.removeMcpServer(id);
      await refreshMcpServers();
    } catch (error) {
      setNotice(errorMessage(error, "Could not remove MCP server"));
    }
  };
  useEffect(() => {
    if (advanced && advancedSection === "mcp") void refreshMcpServers();
  }, [advanced, advancedSection]);
  useEffect(() => {
    if (!autoSave || !preferencesReady) return;
    const dirtyTabs = tabs.filter(
      (tab) => !tab.media && tab.content !== tab.saved,
    );
    if (!dirtyTabs.length) return;
    const timeout = window.setTimeout(() => {
      for (const tab of dirtyTabs) void saveTab(tab, "autosave", false);
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [autoSave, preferencesReady, tabs]);
  useEffect(() => {
    if (!project) return;
    return window.oscode.onProjectFileChanged((change) => {
      void (async () => {
        if (!change.exists) {
          if (change.kind === "rename") {
            const tree = await window.oscode.refreshProject().catch(() => null);
            if (tree)
              setProject((current) =>
                current ? { ...current, tree } : current,
              );
          }
          return;
        }
        if (!tabsRef.current.some((tab) => tab.path === change.path)) {
          if (change.kind === "rename") {
            const tree = await window.oscode.refreshProject().catch(() => null);
            if (tree)
              setProject((current) =>
                current ? { ...current, tree } : current,
              );
          }
          return;
        }
        let opened: Awaited<ReturnType<typeof window.oscode.openProjectFile>>;
        try {
          opened = await window.oscode.openProjectFile(change.path);
        } catch {
          if (change.kind === "rename") {
            const tree = await window.oscode.refreshProject().catch(() => null);
            if (tree)
              setProject((current) =>
                current ? { ...current, tree } : current,
              );
          }
          return;
        }
        if (opened.kind === "media") {
          setTabs((current) =>
            current.map((tab) =>
              tab.path === change.path
                ? {
                    ...tab,
                    content: "",
                    saved: "",
                    media: opened.media,
                  }
                : tab,
            ),
          );
          return;
        }
        const disk = opened.content;
        let conflict = false;
        setTabs((current) =>
          current.map((tab) => {
            if (tab.path !== change.path || tab.saved === disk) return tab;
            if (tab.content === tab.saved || tab.content === disk) {
              externalConflictPaths.current.delete(tab.path);
              return { ...tab, content: disk, saved: disk, media: undefined };
            }
            conflict = true;
            return tab;
          }),
        );
        if (conflict && !externalConflictPaths.current.has(change.path)) {
          externalConflictPaths.current.add(change.path);
          setNotice(
            `${change.path.split(/[\\/]/).at(-1)} changed on disk; your unsaved editor text was preserved`,
          );
        }
        if (change.kind === "rename") {
          const tree = await window.oscode.refreshProject().catch(() => null);
          if (tree)
            setProject((current) => (current ? { ...current, tree } : current));
        }
      })();
    });
  }, [project?.root]);
  const openSaveHistory = async () => {
    if (!active) return;
    setSaveHistoryOpen(true);
    setSaveHistoryLoading(true);
    try {
      setSaveHistory(await window.oscode.listSaveHistory(active.path));
    } catch (error) {
      setNotice(errorMessage(error, "Save history could not load"));
    } finally {
      setSaveHistoryLoading(false);
    }
  };
  const restoreSavedVersion = async (entry: SaveHistoryEntry) => {
    if (!active) return;
    try {
      const content = await window.oscode.restoreSaveHistory(
        active.path,
        entry.id,
      );
      setTabs((current) =>
        current.map((tab) =>
          tab.path === active.path ? { ...tab, content, saved: content } : tab,
        ),
      );
      setSaveHistory(await window.oscode.listSaveHistory(active.path));
      setNotice("Restored an earlier saved version");
    } catch (error) {
      setNotice(
        errorMessage(error, "That saved version could not be restored"),
      );
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === "s") {
          e.preventDefault();
          void save();
        } else if (key === "o") {
          e.preventDefault();
          void openProject();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (!project) return;
    let stopped = false;
    let refreshing = false;
    const refresh = async () => {
      if (stopped || refreshing) return;
      refreshing = true;
      try {
        const state = await window.oscode.gitState();
        if (!stopped) {
          setGit(state);
          setRemote(state.remote);
        }
      } catch {
        // Manual refresh reports errors; background refresh remains quiet.
      } finally {
        refreshing = false;
      }
    };
    const timer = window.setInterval(refresh, 1000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    void refresh();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [project?.root]);
  const gitAction = async (action: string, payload?: string) => {
    if (["fetch", "pull", "push"].includes(action) && !git.remote) {
      setNotice("Add a remote destination before syncing.");
      return false;
    }
    try {
      const state = await window.oscode.gitRun(action, payload);
      setGit(state);
      setRemote(state.remote);
      setNotice(
        (
          {
            init: "Local repository created",
            commit: "Changes committed locally",
            branchCreate: "Branch created and selected",
            branchSwitch: "Branch switched",
            branchDelete: "Local branch removed",
            merge: "Branch merged",
            checkoutDetached: "Detached checkout opened",
            branchCreateAt: "Branch created from commit",
            cherryPick: "Commit applied to the current branch",
            revertCommit: "Revert commit created",
            tagCreateAt: "Tag created on commit",
            remote: "Remote link saved",
            remoteRemove: "Remote link removed",
            fetch: "Remote status fetched",
            pull: "Remote changes pulled",
            push: "Local commits pushed",
          } as Record<string, string>
        )[action] || "Git status updated",
      );
      return true;
    } catch (e) {
      setNotice(errorMessage(e, "Git action failed"));
      return false;
    }
  };
  const deleteRepository = async () => {
    try {
      const state = await window.oscode.deleteRepository();
      setGit(state);
      setRemote("");
      if (!state.initialized) setNotice("Local repository removed");
    } catch (e) {
      setNotice(errorMessage(e, "Repository could not be removed"));
    }
  };
  const absorbSubmodule = async (submodulePath: string) => {
    try {
      const state = await window.oscode.absorbSubmodule(submodulePath);
      setGit(state);
      setNotice("Submodule link removed; its files are now in this repository");
    } catch (e) {
      setNotice(errorMessage(e, "Submodule could not be absorbed"));
    }
  };
  const refreshGit = async () => {
    try {
      const state = await window.oscode.gitState();
      setGit(state);
      setRemote(state.remote);
      setNotice("Git refreshed");
    } catch (e) {
      setNotice(errorMessage(e, "Git could not refresh"));
    }
  };
  const run = async () => {
    if (!active || !active.name.endsWith(".py")) {
      setNotice("Open a Python script to run it.");
      return;
    }
    if (!runtime) {
      setNotice("Select or download a Python interpreter first.");
      return;
    }
    try {
      if (dirty && !(await save())) return;
      setRunOutput("");
      setTerminalOpen(true);
      setTerminalView("run");
      await window.oscode.runPython(active.path, runtime);
      setRunning(true);
    } catch (e) {
      setNotice(errorMessage(e, "Python could not start"));
    }
  };
  const stopPythonProcess = () => {
    setRunning(false);
    void window.oscode
      .stopPython()
      .catch((error) =>
        setNotice(errorMessage(error, "Python process could not stop")),
      );
  };
  const debug = async () => {
    if (!active || !active.name.endsWith(".py")) {
      setNotice("Open a Python script to debug it.");
      return;
    }
    if (!runtime) {
      setNotice("Select or download a Python interpreter first.");
      return;
    }
    try {
      if (dirty && !(await save())) return;
      setRunOutput("");
      setTerminalOpen(true);
      setTerminalView("run");
      await window.oscode.runPython(active.path, runtime, true);
      setRunning(true);
      setAdvanced(false);
    } catch (e) {
      setNotice(errorMessage(e, "Debugger could not start"));
    }
  };
  const refreshRuntimes = async (preferProject = false) => {
    const [found, saved] = await Promise.all([
      window.oscode.listPython(),
      window.oscode.getProjectPython(),
    ]);
    setRuntimes(found);
    const detectedProject = found.find((item) => item.scope === "project");
    const savedRuntime = found.find((item) => item.path === saved);
    const preferred = preferProject
      ? detectedProject || savedRuntime
      : savedRuntime;
    if (preferProject && detectedProject && detectedProject.path !== saved) {
      await window.oscode.setProjectPython(detectedProject.path);
      setNotice(`Detected and selected ${runtimeLabel(detectedProject)}`);
    }
    setRuntime(
      (current) =>
        preferred?.path ||
        (current && found.some((x) => x.path === current)
          ? current
          : found.find((x) => x.version === "3.12" && x.installed)?.path ||
            found.find((x) => x.installed)?.path ||
            ""),
    );
    return preferred;
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let projectActivated = false;
      try {
        const preferences = await window.oscode.loadPreferences();
        if (cancelled) return;
        setTheme(preferences.theme);
        setLocale(preferences.locale);
        setSidebarSide(preferences.sidebarSide);
        setUiScale(preferences.uiScale);
        setEditorFontSize(preferences.editorFontSize);
        setSidebarWidth(preferences.sidebarWidth);
        setGitHeight(preferences.gitHeight);
        setAiPanelWidth(preferences.aiPanelWidth);
        setSidebarVisible(preferences.sidebarVisible);
        setAiVisible(preferences.aiVisible);
        setAiEngine(preferences.aiEngine);
        setAiModel(preferences.aiModel);
        setAiExecutable(preferences.aiExecutable);
        setAiEditMode("ask");
        setAiFileAccess(false);
        setAiWebAccess(false);
        setAiContextLimit(preferences.aiContextLimit);
        setAiHardware(preferences.aiHardware);
        setAiThinkingEnabled(preferences.aiThinkingEnabled);
        setSuggestions(preferences.suggestions);
        setWordWrap(preferences.wordWrap);
        setProseWrap(preferences.proseWrap);
        setMinimap(preferences.minimap);
        setSpellcheck(preferences.spellcheck);
        setAutoSave(preferences.autoSave);
        setAutoUpdateEnabled(preferences.autoUpdateEnabled);
        setAutoUpdatePromptAnswered(preferences.autoUpdatePromptAnswered);
        setAutoUpdateDismissedVersion(preferences.autoUpdateDismissedVersion);
        autoUpdateDismissedVersionRef.current =
          preferences.autoUpdateDismissedVersion;
        if (!preferences.autoUpdatePromptAnswered) {
          setNotifications((current) => [
            ...current.filter((item) => item.id !== "auto-update-opt-in"),
            {
              id: "auto-update-opt-in",
              kind: "auto-update-prompt",
              message: "Turn on automatic updates from GitHub?",
              createdAt: Date.now(),
            },
          ]);
          setNotificationsOpen(true);
        }
        setLastProject(preferences.lastProject);
        if (preferences.lastProject) {
          try {
            const restored = await window.oscode.openProjectPath(
              preferences.lastProject,
            );
            if (!cancelled) {
              await activateProject(restored);
              projectActivated = true;
              setNotice(`Restored ${restored.name}`);
            }
          } catch {
            if (!cancelled) {
              setLastProject("");
              setNotice("The previous project is no longer available");
            }
          }
        }
      } catch (e) {
        if (!cancelled)
          setNotice(errorMessage(e, "Preferences could not load"));
      } finally {
        if (!cancelled && !projectActivated)
          await refreshRuntimes().catch((e) =>
            setNotice(errorMessage(e, "Python runtimes could not load")),
          );
        if (!cancelled) setPreferencesReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!preferencesReady) return;
    const preferences: EditorPreferences = {
      version: 16,
      theme,
      locale,
      sidebarSide,
      uiScale,
      editorFontSize,
      sidebarWidth,
      gitHeight,
      aiPanelWidth,
      sidebarVisible,
      aiVisible,
      aiEngine,
      aiModel,
      aiExecutable,
      aiEditMode,
      aiFileAccess,
      aiWebAccess,
      aiContextLimit,
      aiHardware,
      aiThinkingEnabled,
      suggestions,
      wordWrap,
      proseWrap,
      minimap,
      spellcheck,
      autoSave,
      autoUpdateEnabled,
      autoUpdatePromptAnswered,
      autoUpdateDismissedVersion,
      lastProject,
    };
    const timeout = window.setTimeout(() => {
      void window.oscode
        .savePreferences(preferences)
        .catch((e) => setNotice(errorMessage(e, "Preferences could not save")));
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [
    preferencesReady,
    theme,
    locale,
    sidebarSide,
    uiScale,
    editorFontSize,
    sidebarWidth,
    gitHeight,
    aiPanelWidth,
    sidebarVisible,
    aiVisible,
    aiEngine,
    aiModel,
    aiExecutable,
    aiEditMode,
    aiFileAccess,
    aiWebAccess,
    aiContextLimit,
    aiHardware,
    aiThinkingEnabled,
    suggestions,
    wordWrap,
    proseWrap,
    minimap,
    spellcheck,
    autoSave,
    autoUpdateEnabled,
    autoUpdatePromptAnswered,
    autoUpdateDismissedVersion,
    lastProject,
  ]);
  const installRuntime = async (version: string) => {
    setInstalling(version);
    try {
      const ok = await window.oscode.installPython(version);
      if (!ok) {
        setNotice("Python download is unavailable in this build.");
      } else {
        await refreshRuntimes();
        setNotice(`Python ${version} installed`);
      }
    } catch (e) {
      setNotice(errorMessage(e, "Runtime install failed"));
    } finally {
      setInstalling("");
    }
  };
  const chooseRuntime = async () => {
    try {
      const selected = await window.oscode.choosePython();
      if (!selected) return;
      await refreshRuntimes();
      setRuntime(selected.path);
      if (project) await window.oscode.setProjectPython(selected.path);
      setNotice(`${selected.version} added`);
    } catch (e) {
      setNotice(errorMessage(e, "Interpreter could not be added"));
    }
  };
  const createVenv = async (requestedName: unknown = "") => {
    const name = typeof requestedName === "string" ? requestedName : "";
    try {
      const created = await window.oscode.createVenv(runtime, name);
      await refreshRuntimes();
      setRuntime(created.path);
      await window.oscode.setProjectPython(created.path);
      setEnvName("");
      setNotice(name ? `Environment ${name} created` : "Local .venv created");
    } catch (e) {
      setNotice(errorMessage(e, "Could not create environment"));
    }
  };
  const useDetectedProjectEnvironment = async (interpreter: string) => {
    if (!interpreter || interpreter === runtime) return;
    await refreshRuntimes(true);
    setRuntime(interpreter);
    await window.oscode.setProjectPython(interpreter);
  };
  const refreshPythonPackages = async (interpreter = runtime) => {
    if (!project || !interpreter) {
      setPythonPackages([]);
      setPythonPackageEnvironment("");
      setPythonPackageLocation("");
      setPythonPackageManager("");
      setPythonPackageError(
        project
          ? "No Python interpreter is selected. Choose an installed or bundled Python runtime first."
          : "Open a project before managing Python packages.",
      );
      return;
    }
    try {
      const state = await window.oscode.listPythonPackages(interpreter);
      setPythonPackages(state.packages);
      setPythonPackageEnvironment(state.environment);
      setPythonPackageLocation(state.location);
      setPythonPackageManager(state.manager || "");
      setPythonPackageError(state.error || "");
      await useDetectedProjectEnvironment(state.interpreter);
    } catch (e) {
      setPythonPackages([]);
      setPythonPackageEnvironment("");
      setPythonPackageLocation("");
      setPythonPackageManager("");
      const message = errorMessage(
        e,
        "Installed Python packages could not load",
      );
      setPythonPackageError(message);
      setNotice(message);
    }
  };
  const installProjectPackage = async () => {
    const packageSpec = pythonPackage.trim();
    if (!packageSpec || !project || !runtime) return;
    setPackageOperation(`Installing ${packageSpec}`);
    setPythonPackageError("");
    try {
      const installed = await window.oscode.installPythonPackage(
        runtime,
        packageSpec,
      );
      await useDetectedProjectEnvironment(installed.interpreter);
      setPythonPackage("");
      await refreshPythonPackages(installed.interpreter);
      setNotice(
        `${installed.package} installed${
          installed.createdEnvironment ? " in a new app environment" : ""
        }`,
      );
    } catch (e) {
      const message = errorMessage(e, "Package installation failed");
      setPythonPackageError(message);
      setNotice(message);
    } finally {
      setPackageOperation("");
    }
  };
  const uninstallProjectPackage = async (packageName: string) => {
    if (!project || !runtime) return;
    setPackageOperation(`Removing ${packageName}`);
    try {
      const removed = await window.oscode.uninstallPythonPackage(
        runtime,
        packageName,
      );
      await useDetectedProjectEnvironment(removed.interpreter);
      await refreshPythonPackages(removed.interpreter);
      setNotice(`${removed.package} removed from this project environment`);
    } catch (e) {
      setNotice(errorMessage(e, "Package removal failed"));
    } finally {
      setPackageOperation("");
    }
  };
  useEffect(() => {
    if (!pythonManagerOpen) return;
    void refreshPythonPackages();
  }, [pythonManagerOpen, project?.root, runtime]);
  useEffect(
    () =>
      window.oscode.onPythonEnvironmentChanged(() => {
        void refreshRuntimes(true).then(() => {
          if (pythonManagerOpen) void refreshPythonPackages();
        });
      }),
    [project?.root, pythonManagerOpen, runtime],
  );
  const selectRuntime = async (value: string) => {
    setRuntime(value);
    setPythonPackages([]);
    setPythonPackageEnvironment("");
    setPythonPackageLocation("");
    setPythonPackageManager("");
    setPythonPackageError("");
    if (!project) return;
    try {
      await window.oscode.setProjectPython(value);
    } catch (e) {
      setNotice(errorMessage(e, "Interpreter selection could not save"));
    }
  };
  const chooseRuntimeValue = (value: string) => {
    if (value.startsWith("download:"))
      void installRuntime(value.slice("download:".length));
    else if (value === "more") {
      setAdvanced(true);
      setAdvancedSection("runtimes");
      setSettingsOpen(false);
    } else void selectRuntime(value);
  };
  const createInDirectory = (
    operation: "file" | "folder",
    directory?: TreeEntry,
  ) => {
    setSelectedEntry(directory?.kind === "directory" ? directory : null);
    setProjectOperation(operation);
    setProjectItemName("");
  };
  const runEditorAction = (id: string) => {
    if (!active || active.media) {
      setNotice("Open an editable text file first");
      return;
    }
    void editorRef.current?.getAction(id)?.run();
    editorRef.current?.focus();
  };
  const cycleEditor = (direction: -1 | 1) => {
    const current = tabsRef.current;
    if (!current.length) return;
    const index = Math.max(
      0,
      current.findIndex((tab) => tab.path === activePath),
    );
    const next = (index + direction + current.length) % current.length;
    setActivePath(current[next].path);
  };
  const contextTab = projectContextMenu?.tabPath
    ? tabs.find((tab) => tab.path === projectContextMenu.tabPath)
    : undefined;
  const contextEntry =
    projectContextMenu?.entry || (contextTab ? entryForTab(contextTab) : null);
  const contextTabIndex = contextTab
    ? tabs.findIndex((tab) => tab.path === contextTab.path)
    : -1;
  const projectContextActions: ProjectContextAction[] = (() => {
    if (!projectContextMenu || !project) return [];
    if (projectContextMenu.source === "explorer") {
      const rootEntry: TreeEntry = {
        name: project.name,
        path: project.root,
        kind: "directory",
      };
      return [
        {
          label: "New File",
          icon: "file-plus",
          shortcut: `${shortcutModifier}+N`,
          run: () => createInDirectory("file"),
        },
        {
          label: "New Folder",
          icon: "folder-plus",
          shortcut: `${shortcutModifier}+Shift+N`,
          run: () => createInDirectory("folder"),
        },
        {
          label: projectClipboard ? `Paste ${projectClipboard.name}` : "Paste",
          icon: "clipboard",
          shortcut: `${shortcutModifier}+V`,
          disabled: !projectClipboard,
          run: () => pasteProjectClipboard(),
        },
        {
          label: "Search Project",
          icon: "search",
          shortcut: `${shortcutModifier}+Shift+F`,
          separatorBefore: true,
          run: () => {
            openGlobalProjectSearch();
          },
        },
        {
          label: "Refresh Explorer",
          icon: "refresh-cw",
          run: refreshProjectItems,
        },
        {
          label: "Reveal Project Folder",
          icon: "external-link",
          separatorBefore: true,
          run: () => revealEntry(rootEntry),
        },
      ];
    }
    if (!contextEntry) return [];
    const open = tabs.find((tab) => tab.path === contextEntry.path);
    const folder = contextEntry.kind === "directory";
    const actions: ProjectContextAction[] = folder
      ? [
          {
            label: "New File Here",
            icon: "file-plus",
            run: () => createInDirectory("file", contextEntry),
          },
          {
            label: "New Folder Here",
            icon: "folder-plus",
            run: () => createInDirectory("folder", contextEntry),
          },
          {
            label: projectClipboard
              ? `Paste ${projectClipboard.name}`
              : "Paste Here",
            icon: "clipboard",
            shortcut: `${shortcutModifier}+V`,
            disabled: !projectClipboard,
            run: () => pasteProjectClipboard(contextEntry),
          },
        ]
      : [
          {
            label: "Open",
            icon: "file-text",
            run: () => openFile(contextEntry),
          },
          {
            label: "Open to the Side",
            icon: "columns",
            run: () => openEntryToSide(contextEntry),
          },
          {
            label: "Save",
            icon: "save",
            shortcut: `${shortcutModifier}+S`,
            disabled:
              !open || Boolean(open.media) || open.content === open.saved,
            run: () => (open ? saveTab(open) : undefined),
          },
          {
            label: "Save As…",
            icon: "save",
            shortcut: `${shortcutModifier}+Shift+S`,
            run: () => saveEntryAs(contextEntry),
          },
          {
            label: "Revert from Disk",
            icon: "rotate-ccw",
            disabled: !open || Boolean(open.media),
            run: () => revertEntry(contextEntry),
          },
        ];
    actions.push(
      {
        label: "Cut",
        icon: "scissors",
        shortcut: `${shortcutModifier}+X`,
        separatorBefore: true,
        run: () => rememberProjectClipboard(contextEntry, "move"),
      },
      {
        label: "Copy",
        icon: "copy",
        shortcut: `${shortcutModifier}+C`,
        run: () => rememberProjectClipboard(contextEntry, "copy"),
      },
      {
        label: "Duplicate",
        icon: "copy",
        run: () => duplicateEntry(contextEntry),
      },
      {
        label: "Copy To…",
        icon: "folder-plus",
        run: () => transferEntry(contextEntry, "copy"),
      },
      {
        label: "Move To…",
        icon: "folder",
        run: () => transferEntry(contextEntry, "move"),
      },
      {
        label: "Rename",
        icon: "edit-2",
        shortcut: "F2",
        run: () => renameEntry(contextEntry),
      },
      {
        label: "Copy Relative Path",
        icon: "link",
        separatorBefore: true,
        run: () => copyEntryPath(contextEntry, true),
      },
      {
        label: "Copy Full Path",
        icon: "clipboard",
        run: () => copyEntryPath(contextEntry, false),
      },
      {
        label: "Reveal in File Manager",
        icon: "external-link",
        run: () => revealEntry(contextEntry),
      },
    );
    if (projectContextMenu.source === "tab" && contextTab) {
      actions.push(
        {
          label: "Split Editor",
          icon: "columns",
          separatorBefore: true,
          disabled: Boolean(contextTab.media),
          run: () => {
            setActivePath(contextTab.path);
            toggleSplitView();
          },
        },
        {
          label: "Compare with…",
          icon: "git-merge",
          disabled: Boolean(contextTab.media),
          run: () => {
            setActivePath(contextTab.path);
            setCompareLeftPath(contextTab.path);
            setCompareRightPath("");
            setCompareOpen(true);
          },
        },
        {
          label: "Close Editor",
          icon: "x",
          shortcut: `${shortcutModifier}+W`,
          separatorBefore: true,
          run: () => closeTab(contextTab.path),
        },
        {
          label: "Close Other Editors",
          icon: "x-circle",
          run: () =>
            closeTabSet(
              tabs
                .filter((tab) => tab.path !== contextTab.path)
                .map((tab) => tab.path),
              "Closing the other editors",
            ),
        },
        {
          label: "Close Editors to the Right",
          icon: "chevrons-right",
          disabled: contextTabIndex < 0 || contextTabIndex === tabs.length - 1,
          run: () =>
            closeTabSet(
              tabs.slice(contextTabIndex + 1).map((tab) => tab.path),
              "Closing editors to the right",
            ),
        },
        {
          label: "Close All Editors",
          icon: "x-square",
          run: () =>
            closeTabSet(
              tabs.map((tab) => tab.path),
              "Closing all editors",
            ),
        },
      );
    }
    actions.push({
      label: "Move to Trash",
      icon: "trash-2",
      danger: true,
      separatorBefore: true,
      run: () => trashEntry(contextEntry),
    });
    return actions;
  })();
  menuActions.current = {
    "open-project": () => void openProject(),
    "create-project": () => void createProject(),
    "new-file": () => {
      if (project) beginProjectOperation("file");
      else setNotice("Open a project before creating a file");
    },
    save: () => {
      if (active) void save();
      else setNotice("Open a file before saving");
    },
    "save-as": () => {
      const entry = active ? entryForTab(active) : null;
      if (entry) void saveEntryAs(entry);
      else setNotice("Open a file before using Save As");
    },
    "save-all": () => void saveAll(),
    "revert-file": () => {
      const entry = active ? entryForTab(active) : null;
      if (entry) void revertEntry(entry);
      else setNotice("Open a file before reverting it");
    },
    "close-editor": () => {
      if (active) void closeTab(active.path);
    },
    "close-all-editors": () =>
      void closeTabSet(
        tabs.map((tab) => tab.path),
        "Closing all editors",
      ),
    "new-folder": () => {
      if (project) createInDirectory("folder");
      else setNotice("Open a project before creating a folder");
    },
    "rename-selected": () => {
      const entry = commandEntry();
      if (entry) renameEntry(entry);
      else setNotice("Select a project item before renaming it");
    },
    "duplicate-selected": () => {
      const entry = commandEntry();
      if (entry) void duplicateEntry(entry);
      else setNotice("Select a project item before duplicating it");
    },
    "copy-selected": () => {
      const entry = commandEntry();
      if (entry) void transferEntry(entry, "copy");
      else setNotice("Select a project item before copying it");
    },
    "move-selected": () => {
      const entry = commandEntry();
      if (entry) void transferEntry(entry, "move");
      else setNotice("Select a project item before moving it");
    },
    "trash-selected": () => {
      const entry = commandEntry();
      if (entry) void trashEntry(entry);
      else setNotice("Select a project item before moving it to Trash");
    },
    "reveal-selected": () => {
      const entry = commandEntry();
      if (entry) void revealEntry(entry);
      else setNotice("Select a project item to reveal it");
    },
    "copy-path": () => {
      const entry = commandEntry();
      if (entry) void copyEntryPath(entry, false);
      else setNotice("Select a project item to copy its path");
    },
    "copy-relative-path": () => {
      const entry = commandEntry();
      if (entry) void copyEntryPath(entry, true);
      else setNotice("Select a project item to copy its relative path");
    },
    "editor-undo": () => {
      editorRef.current?.trigger("touch-bar", "undo", null);
      editorRef.current?.focus();
    },
    "editor-redo": () => {
      editorRef.current?.trigger("touch-bar", "redo", null);
      editorRef.current?.focus();
    },
    run: () => void run(),
    stop: stopPythonProcess,
    find: () => runEditorAction("actions.find"),
    replace: () => runEditorAction("editor.action.startFindReplaceAction"),
    "find-in-files": () => {
      openGlobalProjectSearch();
    },
    "format-document": () => runEditorAction("editor.action.formatDocument"),
    "toggle-line-comment": () => runEditorAction("editor.action.commentLine"),
    "duplicate-line": () =>
      runEditorAction("editor.action.copyLinesDownAction"),
    "delete-line": () => runEditorAction("editor.action.deleteLines"),
    "move-line-up": () => runEditorAction("editor.action.moveLinesUpAction"),
    "move-line-down": () =>
      runEditorAction("editor.action.moveLinesDownAction"),
    "go-to-line": () => runEditorAction("editor.action.gotoLine"),
    "next-editor": () => cycleEditor(1),
    "previous-editor": () => cycleEditor(-1),
    "toggle-sidebar": () => setSidebarVisible((current) => !current),
    "toggle-ai": () => setAiVisible((current) => !current),
    "split-editor": toggleSplitView,
    "compare-file": openCompare,
    "toggle-terminal": () => setTerminalOpen((current) => !current),
    "toggle-theme": () =>
      setTheme((current) =>
        current === "dark"
          ? "blue-dark"
          : current === "blue-dark"
            ? "blue-light"
            : "dark",
      ),
    "toggle-advanced": () => setAdvanced((current) => !current),
    "open-settings": () => {
      setAdvanced(false);
      setSettingsOpen(true);
    },
  };
  const runtimeLabel = (item: PythonRuntime) => {
    if (item.scope === "app-project" || item.scope === "project")
      return item.version;
    if (item.version.startsWith("Local "))
      return `Python ${item.version.slice("Local ".length)} · added`;
    if (item.version.startsWith("Conda ")) return item.version;
    const location =
      item.scope === "app"
        ? " · app runtime"
        : item.scope === "system"
          ? " · system"
          : "";
    return `Python ${item.version}${location}`;
  };
  const runtimeOptions = useMemo(
    () =>
      runtimes.map((r) => (
        <option
          key={`${r.version}:${r.path}`}
          value={r.installed ? r.path : `download:${r.version}`}
          disabled={Boolean(installing)}
        >
          {runtimeLabel(r)}
          {r.installed
            ? ""
            : installing === r.version
              ? " · installing…"
              : " · download"}
        </option>
      )),
    [installing, runtimes],
  );
  const activeRuntimeLabel = useMemo(() => {
    const selected = runtimes.find((item) => item.path === runtime);
    if (!selected) return "selected Python";
    return runtimeLabel(selected);
  }, [runtime, runtimes]);
  const filteredPythonPackages = useMemo(
    () =>
      pythonPackages.filter((item) =>
        `${item.name} ${item.version}`
          .toLowerCase()
          .includes(pythonPackageSearch.toLowerCase()),
      ),
    [pythonPackageSearch, pythonPackages],
  );
  const beginHorizontalResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    const start = event.clientX;
    const initial = sidebarWidth;
    const move = (next: PointerEvent) => {
      const delta = next.clientX - start;
      setSidebarWidth(
        Math.max(
          240,
          Math.min(520, initial + (sidebarSide === "left" ? delta : -delta)),
        ),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const beginGitResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    const start = event.clientY;
    const initial = gitHeight;
    const move = (next: PointerEvent) =>
      setGitHeight(
        Math.max(180, Math.min(700, initial + start - next.clientY)),
      );
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const beginAiResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    const start = event.clientX;
    const initial = aiPanelWidth;
    const move = (next: PointerEvent) => {
      const delta = next.clientX - start;
      setAiPanelWidth(
        Math.max(
          280,
          Math.min(560, initial + (aiPanelSide === "left" ? delta : -delta)),
        ),
      );
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const refreshAgentBrowserView = async () => {
    try {
      const snapshot = await window.oscode.agentBrowserSnapshot();
      if (!snapshot) {
        setNotice("The agent browser is not open.");
        return false;
      }
      setBrowserSnapshot(snapshot);
      return true;
    } catch (error) {
      setNotice(errorMessage(error, "The browser preview could not refresh"));
      return false;
    }
  };
  const openAgentBrowserView = async () => {
    const refreshed = await refreshAgentBrowserView();
    if (!refreshed && !browserSnapshot) return;
    setBrowserViewOpen(true);
    setActivePath(agentBrowserTabPath);
  };
  const showAgentBrowserWindow = async () => {
    try {
      const snapshot = await window.oscode.showAgentBrowser();
      if (!snapshot) {
        setNotice("The agent browser is not open.");
        return;
      }
      setBrowserSnapshot(snapshot);
    } catch (error) {
      setNotice(errorMessage(error, "The agent browser could not be shown"));
    }
  };
  const refreshAfterAiChanges = async (files: string[]) => {
    if (!project || !files.length) return;
    const changed = new Set(files.map((file) => file.replace(/\\/g, "/")));
    const root = project.root.replace(/\\/g, "/").replace(/\/$/, "");
    const updated = await Promise.all(
      tabs.map(async (tab) => {
        const relative = tab.path.replace(/\\/g, "/").slice(root.length + 1);
        if (!changed.has(relative) || (!tab.media && tab.content !== tab.saved))
          return tab;
        const opened = await window.oscode.openProjectFile(tab.path);
        return opened.kind === "media"
          ? {
              ...tab,
              content: "",
              saved: "",
              media: opened.media,
            }
          : {
              ...tab,
              content: opened.content,
              saved: opened.content,
              media: undefined,
            };
      }),
    );
    setTabs(updated);
    const nextTree = await window.oscode.refreshProject();
    setProject((current) =>
      current ? { ...current, tree: nextTree } : current,
    );
    const nextGit = await window.oscode.gitState();
    setGit(nextGit);
    setNotice(
      `Local AI updated ${files.length} file${files.length === 1 ? "" : "s"}`,
    );
  };
  const tr = (english: string, arabic: string) =>
    locale === "ar" ? arabic : english;
  const chooseAutomaticUpdates = async (enabled: boolean) => {
    autoUpdateEnabledRef.current = enabled;
    setAutoUpdateEnabled(enabled);
    setAutoUpdatePromptAnswered(true);
    setNotifications((current) =>
      current.filter((item) => item.kind !== "auto-update-prompt"),
    );
    setNotificationsOpen(false);
    try {
      const status = await window.oscode.setAppAutoUpdate(enabled);
      setUpdateStatus(status);
      setNotice(
        enabled ? "Automatic updates enabled" : "Automatic updates remain off",
      );
    } catch (error) {
      setAutoUpdateEnabled(false);
      setNotice(errorMessage(error, "Update preference could not save"));
    }
  };
  const runAppUpdateAction = async () => {
    if (["checking", "downloading", "installing"].includes(updateStatus.state))
      return;
    try {
      const status =
        updateStatus.state === "ready"
          ? await window.oscode.installAppUpdate()
          : updateStatus.state === "available"
            ? await window.oscode.downloadAppUpdate()
            : await window.oscode.checkForAppUpdate();
      setUpdateStatus(status);
      if (["available", "ready", "installing"].includes(status.state))
        setNotificationsOpen(true);
    } catch (error) {
      setNotice(errorMessage(error, "Update action failed"));
    }
  };
  const dismissUpdateReminder = () => {
    const version = updateStatus.version || "";
    if (version) {
      autoUpdateDismissedVersionRef.current = version;
      setAutoUpdateDismissedVersion(version);
    }
    setNotifications((current) =>
      current.filter((item) => item.kind !== "app-update"),
    );
    setNotificationsOpen(false);
  };
  const updateActionLabel =
    updateStatus.state === "ready"
      ? "Install update"
      : updateStatus.state === "available"
        ? "Download update"
        : updateStatus.state === "downloading"
          ? `Update ${updateStatus.percent || 0}%`
          : updateStatus.state === "checking"
            ? "Checking updates"
            : updateStatus.state === "installing"
              ? "Installer opened"
              : "Update";
  const updateReminderDismissed = Boolean(
    updateStatus.version && updateStatus.version === autoUpdateDismissedVersion,
  );
  const showUpdateAction =
    !updateReminderDismissed &&
    ["available", "downloading", "ready", "installing"].includes(
      updateStatus.state,
    );
  const handleAiAttentionChange = (
    next: AiAttention | null,
    completePermission: (() => Promise<void>) | null = null,
  ) => {
    permissionCompletionRef.current = completePermission;
    setPermissionCompletionReady(Boolean(completePermission));
    setAiAttention(next);
    setNotifications((current) => {
      const remaining = current.filter((item) => item.kind !== "ai-attention");
      if (!next) return remaining;
      return [
        ...remaining.slice(-39),
        {
          id: "ai-attention",
          kind: "ai-attention",
          message: `${next.title}${next.detail ? ` · ${next.detail}` : ""}`,
          createdAt: Date.now(),
        },
      ];
    });
  };
  const completeComputerPermission = async () => {
    if (!permissionCompletionRef.current || permissionCompleting) return;
    setPermissionCompleting(true);
    try {
      await permissionCompletionRef.current();
    } finally {
      setPermissionCompleting(false);
    }
  };
  const computerPermissionPending =
    activity?.kind === "computer" && activity.phase === "permission";
  const activityIsDownload = activity?.kind === "download" && activity.active;
  return (
    <div
      className={`app ${theme}`}
      data-platform={window.oscode.platform}
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <div className="mac-titlebar-safe-area" aria-hidden="true" />
      {activity?.kind === "computer" && activity.active && (
        <aside
          className="computer-control-banner"
          role="status"
          aria-live="assertive"
        >
          <span className="computer-control-banner-icon" aria-hidden="true">
            <FeatherIcon
              icon={computerPermissionPending ? "shield" : "mouse-pointer"}
              size="18"
            />
          </span>
          <span>
            <strong>
              {computerPermissionPending
                ? "Computer Control needs permission"
                : "Computer Control active"}
            </strong>
            <small>
              {computerPermissionPending
                ? activity.detail ||
                  "Approve access in your operating-system settings, then return here."
                : `${activity.target || "Visible application"} · You always keep control of the pointer`}
            </small>
          </span>
          <span className="computer-control-shortcut">
            {computerPermissionPending ? (
              <>Approve it in settings, then click Completed</>
            ) : (
              <>
                Press <kbd>Esc</kbd> anywhere to stop
              </>
            )}
          </span>
          <span
            className="computer-control-actions horizontal-menu-scroll"
            data-horizontal-menu
          >
            {computerPermissionPending && permissionCompletionReady && (
              <button
                type="button"
                className="computer-permission-complete"
                aria-label="Computer permission completed"
                disabled={permissionCompleting}
                onClick={() => void completeComputerPermission()}
              >
                <FeatherIcon icon="check" size="15" />
                {permissionCompleting ? "Checking…" : "Completed"}
              </button>
            )}
            <button
              type="button"
              className="computer-control-stop"
              aria-label="Stop Computer Control"
              aria-keyshortcuts="Escape"
              onClick={async () => {
                await window.oscode.stopAgentControl();
                setActivity(null);
                handleAiAttentionChange(null);
              }}
            >
              <FeatherIcon icon="square" size="15" />
              Stop control
            </button>
          </span>
        </aside>
      )}
      <header className="topbar">
        <div className="brand" aria-label="osCode">
          <img src={osCodeIcon} alt="" aria-hidden="true" />
          <div className="brand-wordmark">
            <span>os</span>
            <b>Code</b>
          </div>
        </div>
        <div
          className={`global-activity ${activity || notice ? "has-status" : ""}`}
          aria-live="polite"
        >
          <div
            className="global-activity-strip horizontal-menu-scroll"
            data-horizontal-menu
          >
            <button
              type="button"
              className={`global-search-toggle ${globalSearchOpen ? "active" : ""}`}
              aria-label={globalSearchOpen ? "Close search" : "Open search"}
              aria-expanded={globalSearchOpen}
              disabled={!project}
              onClick={() => {
                setGlobalSearchOpen((open) => !open);
                if (globalSearchOpen) setGlobalSearch("");
              }}
            >
              <FeatherIcon icon={globalSearchOpen ? "x" : "search"} size="17" />
            </button>
            {globalSearchOpen && (
              <label className="global-search expanded">
                <FeatherIcon icon="search" size="17" />
                <input
                  autoFocus
                  type="search"
                  value={globalSearch}
                  aria-label="Search project and AI chats"
                  placeholder="Search code and chats"
                  onChange={(event) => setGlobalSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setGlobalSearch("");
                      setGlobalSearchOpen(false);
                    }
                  }}
                />
              </label>
            )}
            {(browserActivity?.active ||
              browserViewOpen ||
              browserSnapshot) && (
              <div className="browser-view-control">
                <span className="divider" />
                <button
                  className={browserViewOpen ? "active" : ""}
                  aria-pressed={browserViewOpen}
                  title="Watch the agent's isolated browser in an editor tab"
                  onClick={() => void openAgentBrowserView()}
                >
                  <FeatherIcon icon="compass" size="16" />
                  Agent Browser
                </button>
              </div>
            )}
            {(activity || notice) && (
              <div
                className={`top-status ${activity?.network ? "network" : ""} ${activity?.kind === "security" ? "security" : ""}`}
                role="button"
                tabIndex={0}
                title="Open activity details"
                onClick={() => {
                  const message = activity
                    ? [activity.label, activity.url, activity.target]
                        .filter(Boolean)
                        .join(" · ")
                    : notice;
                  if (message)
                    setNotifications((current) =>
                      current.some(
                        (item) =>
                          item.message === message &&
                          Date.now() - item.createdAt < 2_000,
                      )
                        ? current
                        : [
                            ...current.slice(-39),
                            {
                              id: crypto.randomUUID(),
                              message,
                              createdAt: Date.now(),
                            },
                          ],
                    );
                  setNotificationsOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setNotificationsOpen(true);
                  }
                }}
              >
                {activity?.network && <FeatherIcon icon="wifi" size="17" />}
                {activity?.kind === "computer" && (
                  <FeatherIcon icon="mouse-pointer" size="17" />
                )}
                {activity?.kind === "download" && (
                  <FeatherIcon icon="download" size="17" />
                )}
                {activity?.kind === "platformio" && (
                  <FeatherIcon icon="cpu" size="17" />
                )}
                {activity?.kind === "queue" && (
                  <FeatherIcon icon="clock" size="17" />
                )}
                {activity?.kind === "security" && (
                  <FeatherIcon icon="shield" size="17" />
                )}
                <span>{activity?.label || notice}</span>
                {activityIsDownload &&
                  typeof activity.progress === "number" && (
                    <em className="activity-percent">
                      {Math.round(
                        Math.max(0, Math.min(100, activity.progress)),
                      )}
                      %
                    </em>
                  )}
                {activityIsDownload && (
                  <i
                    className={
                      typeof activity.progress === "number" ? "determinate" : ""
                    }
                    role="progressbar"
                    aria-label={activity.label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={activity.progress}
                  >
                    {typeof activity.progress === "number" && (
                      <span
                        style={{
                          width: `${Math.max(0, Math.min(100, activity.progress))}%`,
                        }}
                      />
                    )}
                  </i>
                )}
                <button
                  aria-label={
                    activity ? "Stop current activity" : "Dismiss message"
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    if (activity) void window.oscode.stopCurrentActivity();
                    setActivity(null);
                    setNotice("");
                  }}
                >
                  <FeatherIcon icon="x" size="16" />
                </button>
              </div>
            )}
            <div className="top-actions">
              {pythonContext && (
                <select
                  className="runtime-select"
                  value={runtime}
                  onChange={(event) => chooseRuntimeValue(event.target.value)}
                  aria-label="Python interpreter"
                >
                  {runtimeOptions}
                  <option value="more">Download more…</option>
                </select>
              )}
              {showUpdateAction && (
                <IconButton
                  icon={
                    updateStatus.state === "ready"
                      ? "download-cloud"
                      : updateStatus.state === "downloading"
                        ? "loader"
                        : "refresh-cw"
                  }
                  label={updateActionLabel}
                  className={`app-update-action ${updateStatus.state}`}
                  active={updateStatus.state === "ready"}
                  disabled={["checking", "downloading", "installing"].includes(
                    updateStatus.state,
                  )}
                  onClick={() => void runAppUpdateAction()}
                />
              )}
              <IconButton
                icon="bell"
                label="Notifications"
                badge={aiAttention ? 1 : undefined}
                active={notificationsOpen}
                onClick={() => {
                  setNotificationsOpen((open) => !open);
                  setAdvanced(false);
                  setSettingsOpen(false);
                  setPlatformioOpen(false);
                }}
              />
              <IconButton
                icon="cpu"
                label="PlatformIO"
                className="platformio-action"
                active={platformioOpen}
                onClick={() => {
                  setPlatformioOpen((open) => !open);
                  setAdvanced(false);
                  setSettingsOpen(false);
                  setNotificationsOpen(false);
                }}
              />
              <span className="divider" />
              <IconButton
                icon="sidebar"
                label={tr("Files", "الملفات")}
                active={sidebarVisible}
                onClick={() => setSidebarVisible((visible) => !visible)}
              />
              <IconButton
                icon="message-square"
                label={tr("Chat", "المحادثة")}
                badge={aiAttention ? 1 : undefined}
                active={aiVisible}
                onClick={() => {
                  const opening = !aiVisible;
                  setAiVisible(opening);
                  if (opening) setNotificationsOpen(false);
                  if (opening && aiAttention?.kind !== "permission")
                    handleAiAttentionChange(null);
                }}
              />
              <span className="divider" />
              <IconButton
                icon="sliders"
                label={tr("Advanced", "متقدم")}
                active={advanced}
                onClick={() => {
                  setAdvanced(!advanced);
                  setSettingsOpen(false);
                  setPlatformioOpen(false);
                  setNotificationsOpen(false);
                }}
              />
              <IconButton
                icon="settings"
                label={tr("Settings", "الإعدادات")}
                active={settingsOpen}
                onClick={() => {
                  setSettingsOpen(!settingsOpen);
                  setAdvanced(false);
                  setPlatformioOpen(false);
                  setNotificationsOpen(false);
                }}
              />
            </div>
          </div>
          {!!globalSearch.trim() && (
            <div
              className="global-search-results"
              role="dialog"
              aria-label="Search results"
            >
              <div className="global-search-section">
                <b>Code base</b>
                {globalSearchResults.code.length ? (
                  globalSearchResults.code.map((result) => (
                    <button
                      key={`${result.path}:${result.line}`}
                      onClick={async () => {
                        await openFile({
                          name:
                            result.relativePath.split("/").at(-1) ||
                            result.relativePath,
                          path: result.path,
                          kind: "file",
                        });
                        setPendingRevealLine(result.line);
                        setGlobalSearch("");
                        setGlobalSearchOpen(false);
                      }}
                    >
                      <span>
                        {result.relativePath}:{result.line}
                      </span>
                      <small>{result.preview}</small>
                    </button>
                  ))
                ) : (
                  <p>No code matches.</p>
                )}
              </div>
              <div className="global-search-divider" />
              <div className="global-search-section">
                <b>AI chats</b>
                {globalSearchResults.chats.length ? (
                  globalSearchResults.chats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => {
                        setRequestedAiChat(chat.id);
                        setAiVisible(true);
                        setGlobalSearch("");
                        setGlobalSearchOpen(false);
                      }}
                    >
                      <span>{chat.title}</span>
                      <small>{chat.preview}</small>
                    </button>
                  ))
                ) : (
                  <p>No chat matches.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </header>
      {notificationsOpen && (
        <div
          className="notifications-popover"
          role="dialog"
          aria-modal="false"
          aria-label="Notifications"
        >
          <div className="notifications-header">
            <h2>Notifications</h2>
            <span className="notification-actions">
              <button
                onClick={() =>
                  setNotifications((current) =>
                    current.filter(
                      (item) =>
                        item.kind === "auto-update-prompt" ||
                        item.kind === "ai-attention",
                    ),
                  )
                }
              >
                Clear
              </button>
              <button
                aria-label="Close notifications"
                onClick={() => setNotificationsOpen(false)}
              >
                <FeatherIcon icon="x" size="16" />
              </button>
            </span>
          </div>
          <div className="notification-list">
            {notifications.length ? (
              notifications
                .slice()
                .reverse()
                .map((item) => (
                  <div
                    className={`notification-row ${item.kind === "auto-update-prompt" ? "update-prompt" : ""} ${["auto-update-prompt", "app-update", "ai-attention"].includes(item.kind || "") ? "notification-row-actions" : ""}`}
                    key={item.id}
                  >
                    <div className="notification-content">
                      <p>{item.message}</p>
                      <time dateTime={new Date(item.createdAt).toISOString()}>
                        {new Date(item.createdAt).toLocaleString()}
                      </time>
                    </div>
                    {item.kind === "auto-update-prompt" ? (
                      <div className="notification-choice">
                        <button
                          onClick={() => void chooseAutomaticUpdates(false)}
                        >
                          Don't show again
                        </button>
                        <button
                          className="primary"
                          onClick={() => void chooseAutomaticUpdates(true)}
                        >
                          Turn on
                        </button>
                      </div>
                    ) : item.kind === "app-update" ? (
                      <div className="notification-choice update-actions">
                        <button
                          onClick={() =>
                            setNotifications((current) =>
                              current.filter((entry) => entry.id !== item.id),
                            )
                          }
                        >
                          Later
                        </button>
                        <button onClick={dismissUpdateReminder}>
                          Don't show again
                        </button>
                        <button
                          className="primary"
                          disabled={[
                            "checking",
                            "downloading",
                            "installing",
                          ].includes(updateStatus.state)}
                          onClick={() => void runAppUpdateAction()}
                        >
                          {updateActionLabel}
                        </button>
                      </div>
                    ) : item.kind === "ai-attention" ? (
                      <div className="notification-choice">
                        <button
                          onClick={() => {
                            setAiVisible(true);
                            setNotificationsOpen(false);
                            if (aiAttention?.kind !== "permission")
                              handleAiAttentionChange(null);
                          }}
                        >
                          Open chat
                        </button>
                        {aiAttention?.kind === "permission" &&
                          permissionCompletionReady && (
                            <button
                              className="primary"
                              disabled={permissionCompleting}
                              onClick={() => void completeComputerPermission()}
                            >
                              {permissionCompleting ? "Checking…" : "Completed"}
                            </button>
                          )}
                      </div>
                    ) : (
                      <button
                        className="notification-dismiss"
                        aria-label="Dismiss notification"
                        onClick={() =>
                          setNotifications((current) =>
                            current.filter((entry) => entry.id !== item.id),
                          )
                        }
                      >
                        <FeatherIcon icon="x" size="15" />
                      </button>
                    )}
                  </div>
                ))
            ) : (
              <p className="notification-empty">No notifications.</p>
            )}
          </div>
        </div>
      )}
      {projectContextMenu && (
        <div
          className="project-context-menu"
          role="menu"
          aria-label="File actions"
          style={{
            left: projectContextMenu.x,
            top: projectContextMenu.y,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ),
            ];
            if (!buttons.length) return;
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            const direction = event.key === "ArrowDown" ? 1 : -1;
            buttons[
              (index + direction + buttons.length) % buttons.length
            ].focus();
          }}
        >
          {projectContextActions.map((action, index) => (
            <div
              className={action.separatorBefore ? "menu-separated" : ""}
              key={`${action.label}:${index}`}
            >
              <button
                type="button"
                role="menuitem"
                autoFocus={index === 0}
                className={action.danger ? "danger-text" : ""}
                disabled={action.disabled}
                onClick={() => {
                  setProjectContextMenu(null);
                  void action.run();
                }}
              >
                <FeatherIcon icon={action.icon} size="15" />
                <span>{action.label}</span>
                {action.shortcut && <kbd>{action.shortcut}</kbd>}
              </button>
            </div>
          ))}
        </div>
      )}
      {selectedCommit && (
        <div
          className="modal-scrim"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedCommit(null);
          }}
        >
          <section
            className="git-commit-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Commit ${selectedCommit.shortId}`}
          >
            <div className="compact-panel-head">
              <div>
                <small>COMMIT {selectedCommit.shortId}</small>
                <h2>{selectedCommit.subject}</h2>
              </div>
              <IconButton
                icon="x"
                label="Close commit actions"
                onClick={() => setSelectedCommit(null)}
              />
            </div>
            <p>
              {selectedCommit.author} ·{" "}
              {new Date(selectedCommit.date).toLocaleString()}
            </p>
            <div
              className="git-commit-quick-actions horizontal-menu-scroll"
              data-horizontal-menu
            >
              <button
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Check out ${selectedCommit.shortId} without selecting a branch?`,
                    )
                  )
                    return;
                  if (await gitAction("checkoutDetached", selectedCommit.id))
                    setSelectedCommit(null);
                }}
              >
                <FeatherIcon icon="git-commit" size="16" /> Detached checkout
              </button>
              <button
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Apply ${selectedCommit.shortId} to ${git.branch}?`,
                    )
                  )
                    return;
                  if (await gitAction("cherryPick", selectedCommit.id))
                    setSelectedCommit(null);
                }}
              >
                <FeatherIcon icon="copy" size="16" /> Cherry-pick
              </button>
              <button
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Create a new commit that reverses ${selectedCommit.shortId}?`,
                    )
                  )
                    return;
                  if (await gitAction("revertCommit", selectedCommit.id))
                    setSelectedCommit(null);
                }}
              >
                <FeatherIcon icon="rotate-ccw" size="16" /> Revert commit
              </button>
            </div>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const name = commitBranchName.trim();
                if (!name) return;
                if (
                  await gitAction(
                    "branchCreateAt",
                    JSON.stringify({ name, reference: selectedCommit.id }),
                  )
                ) {
                  setCommitBranchName("");
                  setSelectedCommit(null);
                }
              }}
            >
              <label>
                New branch here
                <span>
                  <input
                    value={commitBranchName}
                    placeholder="feature-name"
                    onChange={(event) =>
                      setCommitBranchName(event.target.value)
                    }
                  />
                  <button disabled={!commitBranchName.trim()}>Create</button>
                </span>
              </label>
            </form>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const name = commitTagName.trim();
                if (!name) return;
                if (
                  await gitAction(
                    "tagCreateAt",
                    JSON.stringify({ name, reference: selectedCommit.id }),
                  )
                ) {
                  setCommitTagName("");
                  setSelectedCommit(null);
                }
              }}
            >
              <label>
                New tag here
                <span>
                  <input
                    value={commitTagName}
                    placeholder="v1.0.0"
                    onChange={(event) => setCommitTagName(event.target.value)}
                  />
                  <button disabled={!commitTagName.trim()}>Create</button>
                </span>
              </label>
            </form>
          </section>
        </div>
      )}
      {compareOpen && project && (
        <div className="modal-scrim" role="presentation">
          <form
            className="compare-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Compare two files"
            onSubmit={(event) => {
              event.preventDefault();
              void startComparison();
            }}
          >
            <div className="compact-panel-head">
              <h2>Compare files</h2>
              <IconButton
                icon="x"
                label="Close file comparison"
                onClick={() => setCompareOpen(false)}
              />
            </div>
            <p>Choose the two project files to show side by side.</p>
            <label>
              First file
              <select
                autoFocus
                value={compareLeftPath}
                onChange={(event) => setCompareLeftPath(event.target.value)}
              >
                {projectFiles(project.tree).map((entry) => (
                  <option value={entry.path} key={`left-${entry.path}`}>
                    {entry.path.slice(project.root.length + 1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Second file
              <select
                value={compareRightPath}
                onChange={(event) => setCompareRightPath(event.target.value)}
              >
                <option value="">Choose a file</option>
                {projectFiles(project.tree).map((entry) => (
                  <option value={entry.path} key={`right-${entry.path}`}>
                    {entry.path.slice(project.root.length + 1)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={
                !compareLeftPath ||
                !compareRightPath ||
                compareLeftPath === compareRightPath
              }
            >
              Show comparison
            </button>
          </form>
        </div>
      )}
      <div className={`workspace sidebar-${sidebarSide} ai-${aiPanelSide}`}>
        {sidebarVisible && (
          <>
            <aside className="sidebar" style={{ width: sidebarWidth }}>
              <section className="explorer panel">
                <div className="section-head">
                  <div>
                    <span className="eyebrow">{tr("PROJECT", "المشروع")}</span>
                    <h2>
                      {project?.name || tr("Your workspace", "مساحة العمل")}
                    </h2>
                  </div>
                  <IconButton
                    icon="folder"
                    label={tr("Browse", "تصفح")}
                    className="project-browse-action"
                    onClick={openProject}
                  />
                </div>
                {project && (
                  <>
                    <div
                      className="explorer-toolbar horizontal-menu-scroll"
                      role="toolbar"
                      aria-label="Project file actions"
                    >
                      <IconButton
                        icon="file-plus"
                        label="New file"
                        onClick={() => beginProjectOperation("file")}
                      />
                      <IconButton
                        icon="folder-plus"
                        label="New folder"
                        onClick={() => beginProjectOperation("folder")}
                      />
                      <IconButton
                        icon="edit-2"
                        label="Rename selected"
                        disabled={!selectedEntry}
                        onClick={() => beginProjectOperation("rename")}
                      />
                      <IconButton
                        icon="copy"
                        label="Duplicate selected"
                        disabled={!selectedEntry}
                        onClick={() =>
                          selectedEntry && void duplicateEntry(selectedEntry)
                        }
                      />
                      <IconButton
                        icon="clipboard"
                        label={
                          projectClipboard
                            ? `Paste ${projectClipboard.name}`
                            : "Paste project item"
                        }
                        disabled={!projectClipboard}
                        onClick={() =>
                          void pasteProjectClipboard(selectedEntry || undefined)
                        }
                      />
                      <IconButton
                        icon="trash-2"
                        label="Move selected to Trash"
                        disabled={!selectedEntry}
                        onClick={trashSelectedEntry}
                      />
                      <IconButton
                        icon="refresh-cw"
                        label="Refresh project"
                        onClick={refreshProjectItems}
                      />
                      <IconButton
                        icon="x-circle"
                        label="Close and forget project"
                        onClick={() => void closeProject()}
                      />
                    </div>
                    {projectOperation && (
                      <form
                        className="project-composer"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void applyProjectOperation();
                        }}
                      >
                        <label htmlFor="project-item-name">
                          {projectOperation === "rename"
                            ? "Rename selected item"
                            : `New ${projectOperation} in ${
                                selectedEntry?.kind === "directory"
                                  ? selectedEntry.name
                                  : project.name
                              }`}
                        </label>
                        <div>
                          <input
                            id="project-item-name"
                            aria-label="Project item name"
                            autoFocus
                            placeholder={
                              projectOperation === "folder"
                                ? "components"
                                : "module.ts"
                            }
                            value={projectItemName}
                            onChange={(event) =>
                              setProjectItemName(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                setProjectOperation(null);
                                setProjectItemName("");
                              }
                            }}
                          />
                          <button
                            type="button"
                            aria-label="Cancel project operation"
                            onClick={() => {
                              setProjectOperation(null);
                              setProjectItemName("");
                            }}
                          >
                            <FeatherIcon icon="x" size="13" />
                          </button>
                          <button
                            type="submit"
                            aria-label="Confirm project operation"
                            disabled={
                              !projectItemName.trim() ||
                              (projectOperation === "rename" &&
                                projectItemName.trim() === selectedEntry?.name)
                            }
                          >
                            <FeatherIcon icon="check" size="13" />
                          </button>
                        </div>
                      </form>
                    )}
                  </>
                )}
                {project ? (
                  <div
                    className="tree"
                    tabIndex={0}
                    aria-label="Project files"
                    onContextMenu={(event) => {
                      if (event.target === event.currentTarget)
                        showProjectContextMenu("explorer", event);
                    }}
                    onKeyDown={(event) => {
                      const entry = selectedEntry;
                      const modifier = event.metaKey || event.ctrlKey;
                      if (entry && event.key === "F2") {
                        event.preventDefault();
                        renameEntry(entry);
                      } else if (
                        entry &&
                        (event.key === "Delete" ||
                          (event.metaKey && event.key === "Backspace"))
                      ) {
                        event.preventDefault();
                        void trashEntry(entry);
                      } else if (
                        entry &&
                        modifier &&
                        event.key.toLowerCase() === "c"
                      ) {
                        event.preventDefault();
                        rememberProjectClipboard(entry, "copy");
                      } else if (
                        entry &&
                        modifier &&
                        event.key.toLowerCase() === "x"
                      ) {
                        event.preventDefault();
                        rememberProjectClipboard(entry, "move");
                      } else if (modifier && event.key.toLowerCase() === "v") {
                        event.preventDefault();
                        void pasteProjectClipboard(entry || undefined);
                      } else if (
                        entry?.kind === "file" &&
                        event.key === "Enter"
                      ) {
                        event.preventDefault();
                        void openFile(entry);
                      }
                    }}
                  >
                    <FileTree
                      entries={project.tree}
                      onOpen={openFile}
                      onExpand={expandDirectory}
                      onError={(error) =>
                        setNotice(
                          errorMessage(error, "Folder could not expand"),
                        )
                      }
                      onSelect={setSelectedEntry}
                      onContextMenu={(entry, event) =>
                        showProjectContextMenu("tree", event, entry)
                      }
                      selectedPath={selectedEntry?.path || ""}
                    />
                  </div>
                ) : (
                  <div className="empty-side">
                    <FeatherIcon icon="folder" />
                    <p>{tr("Open a folder to begin.", "افتح مجلداً للبدء.")}</p>
                    <button className="primary" onClick={openProject}>
                      {tr("Browse folders", "تصفح المجلدات")}
                    </button>
                    <div className="path-divider">
                      <span>{tr("or paste a path", "أو الصق المسار")}</span>
                    </div>
                    <input
                      className="field path-field"
                      aria-label="Project folder path"
                      placeholder="C:\\projects\\my-app"
                      value={pathInput}
                      onChange={(e) => setPathInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openProjectPath();
                      }}
                    />
                    <button
                      className="quiet wide"
                      disabled={!pathInput.trim()}
                      onClick={openProjectPath}
                    >
                      {tr("Open path", "فتح المسار")}
                    </button>
                  </div>
                )}
              </section>
              {gitOpen && (
                <div
                  className="git-resizer"
                  role="separator"
                  aria-label="Resize Git panel"
                  aria-orientation="horizontal"
                  onPointerDown={beginGitResize}
                />
              )}
              <section
                className={`git panel ${gitOpen ? "expanded" : ""}`}
                style={gitOpen ? { height: gitHeight } : undefined}
              >
                <div className="git-panel-head">
                  <button
                    className="section-toggle"
                    onClick={() => setGitOpen(!gitOpen)}
                  >
                    <span>
                      <FeatherIcon icon="git-branch" size="15" />
                      Git
                    </span>
                    <FeatherIcon
                      icon={gitOpen ? "chevron-down" : "chevron-up"}
                      size="15"
                    />
                  </button>
                  <IconButton
                    icon="book-open"
                    label="Open Git help"
                    className="git-help-trigger"
                    active={gitHelpOpen}
                    onClick={() => setGitHelpOpen((open) => !open)}
                  />
                </div>
                {gitHelpOpen && (
                  <div className="git-help-panel">
                    <div className="compact-panel-head">
                      <b>Git help</b>
                      <IconButton
                        icon="x"
                        label="Close Git help"
                        onClick={() => setGitHelpOpen(false)}
                      />
                    </div>
                    <input
                      autoFocus
                      aria-label="Search Git help"
                      placeholder="Search commands"
                      value={gitHelpSearch}
                      onChange={(event) => setGitHelpSearch(event.target.value)}
                    />
                    <div>
                      {gitHelpEntries
                        .filter((entry) =>
                          entry
                            .join(" ")
                            .toLowerCase()
                            .includes(gitHelpSearch.toLowerCase()),
                        )
                        .map(([title, command, detail]) => (
                          <article key={command}>
                            <b>{title}</b>
                            <code>{command}</code>
                            <p>{detail}</p>
                          </article>
                        ))}
                    </div>
                  </div>
                )}
                {gitOpen && (
                  <div className="git-body">
                    {!project ? (
                      <p className="muted">
                        {tr(
                          "Open a project to use Git.",
                          "افتح مشروعاً لاستخدام Git.",
                        )}
                      </p>
                    ) : !git.initialized ? (
                      <div className="git-empty-card">
                        <FeatherIcon icon="git-branch" size="18" />
                        <div>
                          <b>
                            {tr("Start with local Git", "ابدأ بـ Git محلي")}
                          </b>
                        </div>
                        <button
                          className="git-primary-action"
                          onClick={() => gitAction("init")}
                        >
                          <FeatherIcon icon="plus" size="14" />
                          {tr("Create local repository", "إنشاء مستودع محلي")}
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="git-repo-head">
                          <div>
                            <span className="git-local-badge">LOCAL</span>
                            <b>{git.branch}</b>
                            {(git.ahead > 0 || git.behind > 0) && (
                              <small>
                                {git.ahead ? `↑${git.ahead}` : ""}{" "}
                                {git.behind ? `↓${git.behind}` : ""}
                              </small>
                            )}
                          </div>
                          <div className="git-iconbar">
                            <IconButton
                              icon="refresh-cw"
                              label="Refresh Git status"
                              onClick={refreshGit}
                            />
                            <IconButton
                              icon="trash-2"
                              label="Remove local repository"
                              onClick={() => void deleteRepository()}
                            />
                          </div>
                        </div>
                        <details className="git-group git-history-tree" open>
                          <summary>
                            <span>
                              <FeatherIcon icon="git-commit" size="13" />
                              Commit history
                            </span>
                          </summary>
                          <div
                            className="git-sync-summary"
                            aria-label="Commit history legend"
                          >
                            <span title="Files changed since the last commit">
                              <i className="git-sync-dot open" />
                              Open changes · {git.files.length}
                            </span>
                            <span title="Local commits not yet pushed">
                              <i className="git-sync-dot unpushed" />
                              Unpushed · {git.ahead}
                            </span>
                            <span
                              title={
                                git.remote
                                  ? "Commits already available on the remote"
                                  : "No remote repository is linked"
                              }
                            >
                              <i className="git-sync-dot pushed" />
                              {git.remote ? "On remote" : "Local only"}
                            </span>
                          </div>
                          <div className="git-commit-tree">
                            {git.commits.length === 0 ? (
                              <p>No commits yet.</p>
                            ) : (
                              git.commits.map((commit, index) => (
                                <button
                                  className="git-commit-entry"
                                  key={commit.id}
                                  title={`Open actions for ${commit.shortId}`}
                                  onClick={() => {
                                    setCommitBranchName("");
                                    setCommitTagName("");
                                    setSelectedCommit(commit);
                                  }}
                                >
                                  <span className="git-commit-rail">
                                    <i />
                                    {index < git.commits.length - 1 && <b />}
                                  </span>
                                  <span className="git-commit-copy">
                                    <strong>{commit.subject}</strong>
                                    <small>
                                      {commit.shortId} · {commit.author} ·{" "}
                                      {new Date(
                                        commit.date,
                                      ).toLocaleDateString()}
                                    </small>
                                  </span>
                                  <em
                                    className={`git-commit-state ${commit.state}`}
                                  >
                                    {commit.state === "unpushed"
                                      ? "Unpushed"
                                      : commit.state === "pushed"
                                        ? "Pushed"
                                        : "Local"}
                                  </em>
                                </button>
                              ))
                            )}
                          </div>
                        </details>
                        <details className="git-group" open>
                          <summary>
                            <span>
                              <FeatherIcon icon="git-branch" size="13" />{" "}
                              Branches
                            </span>
                            <small>{git.branches.length}</small>
                          </summary>
                          <div
                            className="git-branch-controls horizontal-menu-scroll"
                            data-horizontal-menu
                          >
                            <select
                              aria-label="Local branch"
                              value={branchTarget}
                              onChange={(event) =>
                                setBranchTarget(event.target.value)
                              }
                            >
                              {git.branch === "detached" && (
                                <option value="detached">
                                  Detached HEAD · current
                                </option>
                              )}
                              {git.branches.map((branch) => (
                                <option key={branch} value={branch}>
                                  {branch}
                                  {branch === git.branch ? " · current" : ""}
                                </option>
                              ))}
                            </select>
                            <div className="git-iconbar">
                              <IconButton
                                icon="check-circle"
                                label="Switch to selected branch"
                                disabled={
                                  !branchTarget || branchTarget === git.branch
                                }
                                onClick={() =>
                                  void gitAction("branchSwitch", branchTarget)
                                }
                              />
                              <IconButton
                                icon="plus"
                                label="Create branch"
                                active={branchComposer}
                                onClick={() =>
                                  setBranchComposer(!branchComposer)
                                }
                              />
                              <IconButton
                                icon="git-merge"
                                label="Merge selected into current branch"
                                disabled={
                                  !branchTarget ||
                                  branchTarget === git.branch ||
                                  git.files.length > 0
                                }
                                onClick={() =>
                                  void gitAction("merge", branchTarget)
                                }
                              />
                              <IconButton
                                icon="trash-2"
                                label="Delete selected local branch"
                                disabled={
                                  !branchTarget || branchTarget === git.branch
                                }
                                onClick={() =>
                                  void gitAction("branchDelete", branchTarget)
                                }
                              />
                            </div>
                          </div>
                          {branchComposer && (
                            <form
                              className="git-inline-form"
                              onSubmit={async (event) => {
                                event.preventDefault();
                                if (
                                  await gitAction("branchCreate", branchName)
                                ) {
                                  setBranchName("");
                                  setBranchComposer(false);
                                }
                              }}
                            >
                              <input
                                autoFocus
                                aria-label="New branch name"
                                placeholder="feature/calm-ui"
                                value={branchName}
                                onChange={(event) =>
                                  setBranchName(event.target.value)
                                }
                              />
                              <button
                                type="submit"
                                aria-label="Create new branch"
                                disabled={!branchName.trim()}
                              >
                                <FeatherIcon icon="check" size="13" />
                              </button>
                            </form>
                          )}
                        </details>
                        <details className="git-group">
                          <summary>
                            <span>
                              <FeatherIcon icon="archive" size="13" /> Version
                              tools
                            </span>
                            <small>{git.stashes.length} saved</small>
                          </summary>
                          <p className="git-group-help">
                            Save unfinished work without committing, rename the
                            current branch, or mark a release.
                          </p>
                          <input
                            className="field"
                            aria-label="Branch, tag, or stash name"
                            placeholder="Name or stash note"
                            value={gitUtilityName}
                            onChange={(event) =>
                              setGitUtilityName(event.target.value)
                            }
                          />
                          <div
                            className="git-utility-actions horizontal-menu-scroll"
                            data-horizontal-menu
                          >
                            <button
                              disabled={!gitUtilityName.trim()}
                              onClick={() =>
                                void gitAction("branchRename", gitUtilityName)
                              }
                            >
                              <FeatherIcon icon="edit-3" size="14" /> Rename
                              branch
                            </button>
                            <button
                              disabled={!gitUtilityName.trim()}
                              onClick={() =>
                                void gitAction("tagCreate", gitUtilityName)
                              }
                            >
                              <FeatherIcon icon="tag" size="14" /> Create tag
                            </button>
                            <button
                              disabled={git.files.length === 0}
                              onClick={() =>
                                void gitAction(
                                  "stashCreate",
                                  gitUtilityName || "Saved from osCode",
                                )
                              }
                            >
                              <FeatherIcon icon="archive" size="14" /> Stash
                              changes
                            </button>
                          </div>
                          <form
                            className="git-inline-form detached-checkout"
                            onSubmit={async (event) => {
                              event.preventDefault();
                              if (
                                await gitAction("checkoutDetached", detachedRef)
                              )
                                setDetachedRef("");
                            }}
                          >
                            <input
                              aria-label="Commit or tag to inspect"
                              placeholder="Commit or tag"
                              value={detachedRef}
                              onChange={(event) =>
                                setDetachedRef(event.target.value)
                              }
                            />
                            <button
                              type="submit"
                              disabled={!detachedRef.trim()}
                            >
                              Inspect
                            </button>
                          </form>
                          {git.stashes.map((stash) => (
                            <div className="git-stash-row" key={stash.ref}>
                              <span title={stash.message}>{stash.message}</span>
                              <div className="git-iconbar">
                                <IconButton
                                  icon="corner-down-left"
                                  label={`Apply ${stash.ref}`}
                                  onClick={() =>
                                    void gitAction("stashApply", stash.ref)
                                  }
                                />
                                <IconButton
                                  icon="check-circle"
                                  label={`Apply and remove ${stash.ref}`}
                                  onClick={() =>
                                    void gitAction("stashPop", stash.ref)
                                  }
                                />
                                <IconButton
                                  icon="trash-2"
                                  label={`Remove ${stash.ref}`}
                                  onClick={() =>
                                    void gitAction("stashDrop", stash.ref)
                                  }
                                />
                              </div>
                            </div>
                          ))}
                          {git.tags.length > 0 && (
                            <div className="git-tags">
                              {git.tags.map((tag) => (
                                <span key={tag}>
                                  {tag}
                                  <button
                                    aria-label={`Delete tag ${tag}`}
                                    onClick={() =>
                                      void gitAction("tagDelete", tag)
                                    }
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                          )}
                        </details>
                        {git.submodules.length > 0 && (
                          <div className="submodule-alert git-group-card">
                            <b>
                              <FeatherIcon icon="external-link" size="13" />
                              Linked repositories
                            </b>
                            <p>
                              These folders point to separate Git repositories.
                              Bring their files into this repository to remove
                              the link.
                            </p>
                            {git.submodules.map((submodule) => (
                              <div
                                className="submodule-row"
                                key={submodule.path}
                              >
                                <div>
                                  <strong>{submodule.path}</strong>
                                  <small title={submodule.url}>
                                    {submodule.url || "External Git repository"}
                                  </small>
                                </div>
                                <IconButton
                                  icon="corner-down-left"
                                  label={`Move ${submodule.path} files into this repository`}
                                  onClick={() =>
                                    void absorbSubmodule(submodule.path)
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="changes git-group-card">
                          <div className="changes-head">
                            <span>
                              <FeatherIcon icon="activity" size="13" />
                              {git.files.length} changed file
                              {git.files.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          {git.files.length === 0 && (
                            <p className="git-clean">
                              <FeatherIcon icon="check" size="12" /> Working
                              tree clean
                            </p>
                          )}
                          {git.files.map((f) => (
                            <div className="change" key={f.path}>
                              <i>{`${f.index}${f.workingTree}`}</i>
                              <span title={f.path}>
                                {f.originalPath
                                  ? `${f.originalPath} → ${f.path}`
                                  : f.path}
                              </span>
                              <div className="change-actions">
                                {(f.workingTree.trim() || f.index === "?") && (
                                  <button
                                    type="button"
                                    title={`Stage ${f.path}`}
                                    aria-label={`Stage ${f.path}`}
                                    onClick={() => gitAction("stage", f.path)}
                                  >
                                    <FeatherIcon icon="plus" size="12" />
                                  </button>
                                )}
                                {f.index.trim() && f.index !== "?" && (
                                  <button
                                    type="button"
                                    title={`Unstage ${f.path}`}
                                    aria-label={`Unstage ${f.path}`}
                                    onClick={() => gitAction("unstage", f.path)}
                                  >
                                    <FeatherIcon icon="minus" size="12" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="git-commit-row">
                          <input
                            aria-label="Commit message"
                            placeholder="Describe this change"
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                          />
                          <button
                            type="button"
                            title="Stage all changes"
                            aria-label="Stage all changes"
                            disabled={git.files.length === 0}
                            onClick={() => void gitAction("addAll")}
                          >
                            <FeatherIcon icon="plus-circle" size="14" />
                          </button>
                          <button
                            className="commit-action"
                            disabled={
                              !message.trim() ||
                              !git.files.some(
                                (file) =>
                                  file.index !== " " && file.index !== "?",
                              )
                            }
                            title={
                              git.files.some(
                                (file) =>
                                  file.index !== " " && file.index !== "?",
                              )
                                ? "Commit staged changes"
                                : "Stage a changed file before committing"
                            }
                            onClick={async () => {
                              if (await gitAction("commit", message))
                                setMessage("");
                            }}
                          >
                            Commit
                          </button>
                        </div>
                        <details className="git-group">
                          <summary>
                            <span>
                              <FeatherIcon icon="link" size="13" /> Remote
                              <em>{git.remote ? "linked" : "optional"}</em>
                            </span>
                          </summary>
                          <p className="git-group-help">
                            {git.remote
                              ? "Only fetch, pull, and push contact this destination."
                              : "This repository stays entirely local until you add a destination."}
                          </p>
                          <input
                            className="field"
                            aria-label="Remote repository URL"
                            placeholder="https://… or git@host:owner/repo.git"
                            value={remote}
                            onChange={(e) => setRemote(e.target.value)}
                          />
                          <div
                            className="git-remote-actions horizontal-menu-scroll"
                            data-horizontal-menu
                          >
                            <button
                              disabled={!remote.trim() || remote === git.remote}
                              onClick={() => void gitAction("remote", remote)}
                            >
                              <FeatherIcon icon="link" size="13" />
                              {git.remote ? "Update link" : "Add link"}
                            </button>
                            <IconButton
                              icon="refresh-cw"
                              label="Fetch remote status"
                              disabled={!git.remote}
                              onClick={() => void gitAction("fetch")}
                            />
                            <IconButton
                              icon="download"
                              label="Pull remote changes"
                              disabled={!git.remote}
                              onClick={() => void gitAction("pull")}
                            />
                            <IconButton
                              icon="upload"
                              label="Push local commits"
                              disabled={!git.remote}
                              onClick={() => void gitAction("push")}
                            />
                            <IconButton
                              icon="link-2"
                              label="Remove remote link"
                              disabled={!git.remote}
                              onClick={() => void gitAction("remoteRemove")}
                            />
                          </div>
                        </details>
                      </>
                    )}
                  </div>
                )}
              </section>
            </aside>
            <div
              className="sidebar-resizer"
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              onPointerDown={beginHorizontalResize}
            />
          </>
        )}
        <main className="editor-area">
          <div
            className="tabs horizontal-menu-scroll"
            data-horizontal-menu
            ref={editorTabsRef}
            onWheel={(event) => {
              const strip = event.currentTarget;
              if (strip.scrollWidth <= strip.clientWidth) return;
              strip.scrollLeft += event.deltaY || event.deltaX;
            }}
          >
            {browserViewOpen && (
              <div
                className={`tab browser-tab ${activePath === agentBrowserTabPath ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="tab-select"
                  onClick={() => setActivePath(agentBrowserTabPath)}
                  aria-label="Open Agent browser tab"
                >
                  <FeatherIcon icon="compass" size="14" />
                  <span>Agent browser</span>
                </button>
                {browserSnapshot?.loading && <i />}
                <button
                  type="button"
                  className="tab-close"
                  aria-label="Close Agent browser tab"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setBrowserViewOpen(false);
                  }}
                >
                  <FeatherIcon icon="x" size="13" />
                </button>
              </div>
            )}
            {tabs.map((t) => (
              <div
                className={`tab ${t.path === activePath ? "active" : ""}`}
                key={t.path}
                onContextMenu={(event) =>
                  showProjectContextMenu("tab", event, entryForTab(t), t.path)
                }
              >
                <button
                  type="button"
                  className="tab-select"
                  onClick={() => setActivePath(t.path)}
                  aria-label={`Open ${t.name}`}
                >
                  <span>{t.name}</span>
                </button>
                {!t.media && t.content !== t.saved && <i />}
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`Close ${t.name}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void closeTab(t.path);
                  }}
                >
                  <FeatherIcon icon="x" size="13" />
                </button>
              </div>
            ))}
          </div>
          {activePath === agentBrowserTabPath && browserViewOpen ? (
            <section
              className="agent-browser-view"
              aria-label="Agent browser preview"
            >
              <div className="agent-browser-toolbar">
                <span className="agent-browser-status">
                  <FeatherIcon icon="shield" size="15" />
                  <span>
                    <b>Agent Browser</b>
                    <small>
                      {browserSnapshot?.loading
                        ? "Loading the page…"
                        : browserActivity?.label || "Live isolated preview"}
                    </small>
                  </span>
                </span>
                <output title={browserSnapshot?.url || ""}>
                  {browserSnapshot?.url || "Waiting for a page…"}
                </output>
                <div
                  className="agent-browser-actions horizontal-menu-scroll"
                  data-horizontal-menu
                >
                  <button
                    title="Show the live browser window"
                    onClick={() => void showAgentBrowserWindow()}
                  >
                    <FeatherIcon icon="external-link" size="15" /> Open live
                  </button>
                  <button onClick={() => void refreshAgentBrowserView()}>
                    <FeatherIcon icon="refresh-cw" size="15" /> Refresh
                  </button>
                </div>
              </div>
              <div className="agent-browser-canvas">
                {browserSnapshot?.imageDataUrl ? (
                  <img
                    src={browserSnapshot.imageDataUrl}
                    alt={`Preview of ${browserSnapshot.title}`}
                    draggable={false}
                  />
                ) : (
                  <p>The agent browser has not rendered a page yet.</p>
                )}
              </div>
            </section>
          ) : active?.media ? (
            <MediaPreview file={active.media} name={active.name} />
          ) : active ? (
            <>
              <div
                className="editor-command-bar horizontal-menu-scroll"
                data-horizontal-menu
                role="toolbar"
                aria-label="Editor commands"
              >
                <button
                  title={`${shortcutModifier}+Z`}
                  onClick={() => {
                    editorRef.current?.trigger("toolbar", "undo", null);
                    editorRef.current?.focus();
                  }}
                >
                  <FeatherIcon icon="corner-up-left" size="15" /> Undo
                </button>
                <button
                  title={`${shortcutModifier}+Shift+Z`}
                  onClick={() => {
                    editorRef.current?.trigger("toolbar", "redo", null);
                    editorRef.current?.focus();
                  }}
                >
                  <FeatherIcon icon="corner-up-right" size="15" /> Redo
                </button>
                <button
                  className={dirty ? "active" : ""}
                  title={`${shortcutModifier}+S`}
                  onClick={() => void save()}
                >
                  <FeatherIcon icon="save" size="15" /> Save
                </button>
                <button onClick={() => void saveEntryAs(entryForTab(active))}>
                  <FeatherIcon icon="copy" size="15" /> Save As
                </button>
                <button disabled={!hasDirtyTabs} onClick={() => void saveAll()}>
                  <FeatherIcon icon="layers" size="15" /> Save All
                </button>
                <button onClick={() => void openSaveHistory()}>
                  <FeatherIcon icon="clock" size="15" /> Save history
                </button>
                {pythonContext && (
                  <>
                    <span
                      className="editor-command-divider"
                      aria-hidden="true"
                    />
                    <button
                      className="editor-run-action"
                      onClick={() => void run()}
                      disabled={
                        running || !runtime || !active?.name.endsWith(".py")
                      }
                    >
                      <FeatherIcon icon="play" size="15" /> Run
                    </button>
                    <button
                      className="editor-stop-action"
                      onClick={stopPythonProcess}
                      disabled={!running}
                    >
                      <FeatherIcon icon="square" size="15" /> Stop
                    </button>
                  </>
                )}
                <span className="editor-command-divider" aria-hidden="true" />
                <button
                  onClick={() =>
                    editorRef.current?.getAction("actions.find")?.run()
                  }
                >
                  <FeatherIcon icon="search" size="15" /> Find
                </button>
                <button
                  onClick={() =>
                    editorRef.current
                      ?.getAction("editor.action.startFindReplaceAction")
                      ?.run()
                  }
                >
                  <FeatherIcon icon="repeat" size="15" /> Replace
                </button>
                {isProseFile(active.name) && (
                  <button
                    className={spellcheck ? "active" : ""}
                    aria-pressed={spellcheck}
                    title="Right-click an underlined word for suggestions, Replace all, or Add to dictionary"
                    onClick={() => {
                      const next = !spellcheck;
                      setSpellcheck(next);
                      setNotice(
                        next
                          ? "Spellcheck on · right-click an underlined word"
                          : "Spellcheck off",
                      );
                    }}
                  >
                    <FeatherIcon
                      icon={spellcheck ? "check-square" : "square"}
                      size="15"
                    />{" "}
                    Spellcheck
                  </button>
                )}
                {!isMarkdownFile(active.name) && (
                  <>
                    <button
                      className={editorView === "split" ? "active" : ""}
                      onClick={toggleSplitView}
                    >
                      <FeatherIcon icon="columns" size="15" /> Split
                    </button>
                    <button
                      className={editorView === "compare" ? "active" : ""}
                      onClick={() =>
                        editorView === "compare"
                          ? setEditorView("single")
                          : openCompare()
                      }
                    >
                      <FeatherIcon icon="git-merge" size="15" /> Compare
                    </button>
                  </>
                )}
              </div>
              {isMarkdownFile(active.name) && (
                <div
                  className="markdown-toolbar horizontal-menu-scroll"
                  data-horizontal-menu
                  role="group"
                  aria-label="Markdown view"
                >
                  {(["edit", "split", "preview"] as const).map((view) => (
                    <button
                      key={view}
                      className={markdownView === view ? "active" : ""}
                      onClick={() => setMarkdownView(view)}
                    >
                      {view[0].toUpperCase() + view.slice(1)}
                    </button>
                  ))}
                </div>
              )}
              <div
                className={`editor-content ${isMarkdownFile(active.name) ? `markdown-${markdownView}` : ""}`}
              >
                {(!isMarkdownFile(active.name) || markdownView !== "preview") &&
                  (isMarkdownFile(active.name) || editorView === "single") && (
                    <Suspense
                      fallback={
                        <div className="editor-loading">Editor loading…</div>
                      }
                    >
                      <Editor
                        path={active.path}
                        value={active.content}
                        theme={
                          theme === "blue-light"
                            ? "oscode-light"
                            : theme === "blue-dark"
                              ? "oscode-blue-dark"
                              : "oscode-dark"
                        }
                        beforeMount={(m) => {
                          monacoRef.current = m;
                          setMonacoReady(true);
                          m.editor.defineTheme("oscode-dark", {
                            base: "vs-dark",
                            inherit: true,
                            rules: [
                              { token: "keyword", foreground: "89cff0" },
                              { token: "string", foreground: "b8d68c" },
                              { token: "number", foreground: "d7a96b" },
                              {
                                token: "comment",
                                foreground: "71807f",
                                fontStyle: "italic",
                              },
                              { token: "type", foreground: "9bbce0" },
                              {
                                token: "type.identifier",
                                foreground: "9bbce0",
                              },
                              { token: "identifier", foreground: "d9e2e1" },
                              { token: "delimiter", foreground: "91a09f" },
                              { token: "tag", foreground: "89cff0" },
                              { token: "attribute.name", foreground: "d7a96b" },
                              {
                                token: "attribute.value",
                                foreground: "b8d68c",
                              },
                            ],
                            colors: {
                              "editor.background": "#171819",
                              "editorLineNumber.foreground": "#687174",
                              "editorCursor.foreground": "#89cff0",
                              "editor.selectionBackground": "#34484f",
                            },
                          });
                          m.editor.defineTheme("oscode-light", {
                            base: "vs",
                            inherit: true,
                            rules: [
                              { token: "keyword", foreground: "1b6f91" },
                              { token: "string", foreground: "477c22" },
                              { token: "number", foreground: "9b5f13" },
                              {
                                token: "comment",
                                foreground: "72807e",
                                fontStyle: "italic",
                              },
                              { token: "type", foreground: "315f9a" },
                              {
                                token: "type.identifier",
                                foreground: "315f9a",
                              },
                              { token: "tag", foreground: "1b6f91" },
                              { token: "attribute.name", foreground: "9b5f13" },
                            ],
                            colors: { "editor.background": "#f7fcff" },
                          });
                          m.editor.defineTheme("oscode-blue-dark", {
                            base: "vs-dark",
                            inherit: true,
                            rules: [
                              { token: "keyword", foreground: "7EB8FF" },
                              { token: "string", foreground: "A8D99B" },
                              { token: "number", foreground: "F0B66F" },
                              {
                                token: "comment",
                                foreground: "7589A8",
                                fontStyle: "italic",
                              },
                              { token: "type", foreground: "A9C7FF" },
                              {
                                token: "type.identifier",
                                foreground: "A9C7FF",
                              },
                              { token: "identifier", foreground: "EAF2FF" },
                              { token: "delimiter", foreground: "9FAFC8" },
                              { token: "tag", foreground: "7EB8FF" },
                              { token: "attribute.name", foreground: "F0B66F" },
                              {
                                token: "attribute.value",
                                foreground: "A8D99B",
                              },
                            ],
                            colors: {
                              "editor.background": "#07111F",
                              "editorLineNumber.foreground": "#556B8D",
                              "editorCursor.foreground": "#75B8FF",
                              "editor.selectionBackground": "#173A64",
                            },
                          });
                        }}
                        onMount={(instance) => {
                          editorRef.current = instance;
                        }}
                        revealLine={pendingRevealLine}
                        onReveal={() => setPendingRevealLine(0)}
                        onChange={(v) =>
                          setTabs((x) =>
                            x.map((t) =>
                              t.path === active.path
                                ? { ...t, content: v || "" }
                                : t,
                            ),
                          )
                        }
                        options={{
                          fontFamily: "Fira Code",
                          fontSize: editorFontSize,
                          fontLigatures: true,
                          ...editorChrome(minimap),
                          wordWrap:
                            wordWrap || (proseWrap && isProseFile(active.name))
                              ? "on"
                              : "off",
                          quickSuggestions: suggestions,
                          suggestOnTriggerCharacters: suggestions,
                          parameterHints: { enabled: suggestions },
                          bracketPairColorization: { enabled: true },
                          colorDecorators: true,
                          padding: { top: 22 },
                          lineNumbersMinChars: 3,
                          scrollBeyondLastLine: false,
                          renderLineHighlight: "gutter",
                          smoothScrolling: true,
                          automaticLayout: true,
                        }}
                      />
                    </Suspense>
                  )}
                {!isMarkdownFile(active.name) && editorView === "split" && (
                  <Suspense
                    fallback={
                      <div className="editor-loading">Editor loading…</div>
                    }
                  >
                    <SplitEditor
                      tabs={textTabs}
                      leftPath={splitLeftTab?.path || active.path}
                      rightPath={splitRightTab?.path || active.path}
                      theme={
                        theme === "blue-light"
                          ? "oscode-light"
                          : theme === "blue-dark"
                            ? "oscode-blue-dark"
                            : "oscode-dark"
                      }
                      onSelect={(side, path) => {
                        if (side === "left") setSplitLeftPath(path);
                        else setSplitRightPath(path);
                        setActivePath(path);
                      }}
                      onChange={(path, value) =>
                        setTabs((items) =>
                          items.map((tab) =>
                            tab.path === path
                              ? { ...tab, content: value }
                              : tab,
                          ),
                        )
                      }
                      options={{
                        fontFamily: "Fira Code",
                        fontSize: editorFontSize,
                        fontLigatures: true,
                        ...editorChrome(minimap),
                        wordWrap: wordWrap ? "on" : "off",
                        automaticLayout: true,
                        smoothScrolling: true,
                        scrollBeyondLastLine: false,
                      }}
                    />
                  </Suspense>
                )}
                {!isMarkdownFile(active.name) &&
                  editorView === "compare" &&
                  comparison && (
                    <div className="comparison-view">
                      <div className="comparison-labels">
                        <span title={comparison.leftPath}>
                          {comparison.leftName}
                        </span>
                        <span title={comparison.rightPath}>
                          {comparison.rightName}
                        </span>
                        <button onClick={openCompare}>Choose files</button>
                      </div>
                      <Suspense
                        fallback={
                          <div className="editor-loading">
                            Comparison loading…
                          </div>
                        }
                      >
                        <DiffEditor
                          originalPath={comparison.leftPath}
                          originalValue={comparison.leftContent}
                          modifiedPath={comparison.rightPath}
                          modifiedValue={comparison.rightContent}
                          theme={
                            theme === "blue-light"
                              ? "oscode-light"
                              : theme === "blue-dark"
                                ? "oscode-blue-dark"
                                : "oscode-dark"
                          }
                          options={{
                            fontFamily: "Fira Code",
                            fontSize: editorFontSize,
                            ...editorChrome(minimap),
                            automaticLayout: true,
                            scrollBeyondLastLine: false,
                          }}
                        />
                      </Suspense>
                    </div>
                  )}
                {isMarkdownFile(active.name) && markdownView !== "edit" && (
                  <MarkdownPreview
                    content={active.content}
                    filePath={active.path}
                    theme={theme}
                    onNotice={setNotice}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="welcome">
              <img className="welcome-icon" src={osCodeIcon} alt="" />
              <div className="welcome-logo" aria-label="osCode">
                <span>os</span>
                <b>Code</b>
              </div>
              {project ? (
                <>
                  <h1>{tr("Open or create a file", "افتح ملفاً أو أنشئه")}</h1>
                  <p>
                    {tr(
                      `Choose a file from ${project.name}, or create a new one.`,
                      `اختر ملفاً من ${project.name} أو أنشئ ملفاً جديداً.`,
                    )}
                  </p>
                  <button
                    className="primary"
                    onClick={() => {
                      setSidebarVisible(true);
                      beginProjectOperation("file");
                    }}
                  >
                    <FeatherIcon icon="file-plus" size="15" />
                    {tr("Create a file", "إنشاء ملف")}
                  </button>
                  <div className="shortcuts">
                    <span>
                      <kbd>{shortcutModifier}</kbd> <kbd>N</kbd> create
                    </span>
                    <span>
                      {tr(
                        "Select a file in the project",
                        "اختر ملفاً من المشروع",
                      )}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <h1>{tr("Build things…", "ابنِ أشياء…")}</h1>
                  <p>
                    {tr(
                      "Open a project and let the code take the space it deserves.",
                      "افتح مشروعاً وابدأ الكتابة.",
                    )}
                  </p>
                  <div className="welcome-project-actions">
                    <button className="primary" onClick={openProject}>
                      <FeatherIcon icon="folder" size="15" />
                      {tr("Open a project", "فتح مشروع")}
                    </button>
                    <button onClick={createProject}>
                      <FeatherIcon icon="folder-plus" size="15" />
                      {tr("Create project folder", "إنشاء مجلد مشروع")}
                    </button>
                  </div>
                  <div className="shortcuts">
                    <span>
                      <kbd>{shortcutModifier}</kbd> <kbd>O</kbd> open
                    </span>
                    <span>
                      <kbd>{shortcutModifier}</kbd> <kbd>S</kbd> save
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
          {saveHistoryOpen && active && (
            <div
              className="save-history-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget)
                  setSaveHistoryOpen(false);
              }}
            >
              <section
                className="save-history-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={`Save history for ${active.name}`}
              >
                <header>
                  <span>
                    <b>Save history</b>
                    <small>{active.name} · stored locally and encrypted</small>
                  </span>
                  <IconButton
                    icon="x"
                    label="Close save history"
                    onClick={() => setSaveHistoryOpen(false)}
                  />
                </header>
                <div className="save-history-list">
                  {saveHistoryLoading ? (
                    <p>Loading saved versions…</p>
                  ) : saveHistory.length ? (
                    saveHistory.map((entry) => (
                      <article key={entry.id}>
                        <span>
                          <b>{new Date(entry.createdAt).toLocaleString()}</b>
                          <small>
                            {entry.source === "autosave"
                              ? "Autosave"
                              : entry.source === "agent"
                                ? "Before agent edit"
                                : entry.source === "restore"
                                  ? "Before restore"
                                  : "Manual save"}
                            {` · ${Math.max(1, Math.ceil(entry.bytes / 1024))} KB`}
                          </small>
                        </span>
                        <button onClick={() => void restoreSavedVersion(entry)}>
                          <FeatherIcon icon="rotate-ccw" size="14" /> Restore
                        </button>
                      </article>
                    ))
                  ) : (
                    <p>
                      Earlier content appears here after this file is saved.
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}
          {settingsOpen && (
            <div className="settings-dock">
              <div className="settings-title">
                <h3>{tr("Settings", "الإعدادات")}</h3>
                <IconButton
                  icon="x"
                  label="Close settings"
                  onClick={() => setSettingsOpen(false)}
                />
              </div>
              <section>
                <span className="settings-label">
                  {tr("APPEARANCE", "المظهر")}
                </span>
                <div className="theme-choice" role="group" aria-label="Theme">
                  <button
                    className={theme === "dark" ? "active" : ""}
                    onClick={() => setTheme("dark")}
                  >
                    <FeatherIcon icon="droplet" size="14" />
                    {tr("Gunmetal + blue", "رمادي معدني وأزرق")}
                  </button>
                  <button
                    className={theme === "blue-dark" ? "active" : ""}
                    onClick={() => setTheme("blue-dark")}
                  >
                    <FeatherIcon icon="moon" size="14" />
                    {tr("Blue dark", "أزرق داكن")}
                  </button>
                  <button
                    className={theme === "blue-light" ? "active" : ""}
                    onClick={() => setTheme("blue-light")}
                  >
                    <FeatherIcon icon="sun" size="14" />
                    {tr("Blue light", "أزرق فاتح")}
                  </button>
                </div>
                <label className="settings-select-row">
                  <span>{tr("Interface size", "حجم الواجهة")}</span>
                  <select
                    value={uiScale}
                    onChange={(event) =>
                      setUiScale(Number(event.target.value) as typeof uiScale)
                    }
                  >
                    <option value={1}>100%</option>
                    <option value={1.15}>115%</option>
                    <option value={1.3}>130%</option>
                    <option value={1.5}>150%</option>
                    <option value={1.7}>170%</option>
                  </select>
                </label>
                <label className="settings-select-row">
                  <span>{tr("Code size", "حجم خط الكود")}</span>
                  <select
                    value={editorFontSize}
                    onChange={(event) =>
                      setEditorFontSize(Number(event.target.value))
                    }
                  >
                    {[12, 14, 16, 18, 20, 22, 24].map((size) => (
                      <option key={size} value={size}>
                        {size}px
                      </option>
                    ))}
                  </select>
                </label>
              </section>
              <section>
                <span className="settings-label">
                  {tr("LANGUAGE", "اللغة")}
                </span>
                <label className="settings-select-row">
                  <span>{tr("Language", "اللغة")}</span>
                  <select
                    value={locale}
                    onChange={(event) => {
                      const next = event.target.value as "en" | "ar";
                      setLocale(next);
                      if (next === "ar") {
                        setSidebarSide("right");
                      }
                    }}
                  >
                    <option value="en">English</option>
                    <option value="ar">العربية</option>
                  </select>
                </label>
                <label className="settings-select-row">
                  <span>
                    {tr("Project and AI layout", "تخطيط المشروع والذكاء")}
                  </span>
                  <select
                    value={sidebarSide}
                    onChange={(event) => {
                      const next = event.target.value as "left" | "right";
                      setSidebarSide(next);
                    }}
                  >
                    <option value="left">
                      {tr(
                        "Project left · AI right",
                        "المشروع يمين · الذكاء يسار",
                      )}
                    </option>
                    <option value="right">
                      {tr(
                        "AI left · Project right",
                        "الذكاء يمين · المشروع يسار",
                      )}
                    </option>
                  </select>
                </label>
              </section>
              <section>
                <span className="settings-label">{tr("EDITOR", "المحرر")}</span>
                <Toggle
                  label={tr("Suggestions", "الاقتراحات")}
                  value={suggestions}
                  set={setSuggestions}
                />
                <Toggle
                  label={tr("Wrap long lines", "التفاف الأسطر")}
                  value={wordWrap}
                  set={setWordWrap}
                />
                <Toggle
                  label={tr("Wrap prose files", "التفاف ملفات النصوص")}
                  value={proseWrap}
                  set={setProseWrap}
                />
                <Toggle
                  label={tr("Code minimap", "خريطة الكود")}
                  value={minimap}
                  set={setMinimap}
                />
                <Toggle
                  label={tr("Spellcheck text files", "التدقيق الإملائي")}
                  value={spellcheck}
                  set={setSpellcheck}
                />
                <Toggle
                  label={tr("Autosave edited files", "الحفظ التلقائي للملفات")}
                  value={autoSave}
                  set={setAutoSave}
                />
              </section>
              <section>
                <span className="settings-label">
                  {tr("UPDATES", "التحديثات")}
                </span>
                <Toggle
                  label={tr("Automatic updates", "التحديثات التلقائية")}
                  value={autoUpdateEnabled}
                  set={(enabled) => void chooseAutomaticUpdates(enabled)}
                />
                <p className="settings-note" aria-live="polite">
                  {updateStatus.message}
                </p>
                {updateStatus.channel && (
                  <p className="settings-update-channel">
                    Channel: {updateStatus.channel}
                  </p>
                )}
                {updateStatus.state === "downloading" && (
                  <div
                    className="settings-update-progress"
                    role="progressbar"
                    aria-label="Downloading osCode update"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={updateStatus.percent || 0}
                  >
                    <i
                      style={{
                        width: `${Math.max(0, Math.min(100, updateStatus.percent || 0))}%`,
                      }}
                    />
                  </div>
                )}
                <button
                  className="settings-update-check"
                  disabled={["checking", "downloading", "installing"].includes(
                    updateStatus.state,
                  )}
                  onClick={() => void runAppUpdateAction()}
                >
                  <FeatherIcon
                    icon={
                      updateStatus.state === "ready"
                        ? "download-cloud"
                        : "refresh-cw"
                    }
                    size="15"
                  />
                  {updateActionLabel}
                </button>
              </section>
              <section>
                <span className="settings-label">
                  {tr("PRIVACY", "الخصوصية")}
                </span>
                <p className="settings-note">
                  {tr(
                    "Chats and settings are encrypted in application data with an app-managed local key.",
                    "المحادثات والإعدادات مشفرة في بيانات التطبيق.",
                  )}
                </p>
                <button
                  className="settings-update-check"
                  onClick={async () => {
                    try {
                      await window.oscode.openSecureData();
                    } catch (error) {
                      setNotice(
                        errorMessage(error, "Could not open secure data"),
                      );
                    }
                  }}
                >
                  <FeatherIcon icon="folder" size="15" />
                  {tr("Open secure data", "فتح البيانات الآمنة")}
                </button>
              </section>
            </div>
          )}
          {platformioOpen && (
            <PlatformioPanel
              projectRoot={project?.root || ""}
              onClose={() => setPlatformioOpen(false)}
              onProjectChanged={refreshProjectItems}
              onNotice={setNotice}
              onActivity={setActivity}
            />
          )}
          {advanced && (
            <div
              className={`advanced-dock${advancedSection === "mcp" ? " advanced-dock-wide" : ""}${advancedSection === "runtimes" ? " advanced-dock-runtimes" : ""}`}
            >
              <div className="advanced-title">
                {advancedSection !== "menu" && (
                  <IconButton
                    icon="arrow-left"
                    label="Back to Advanced"
                    onClick={() => setAdvancedSection("menu")}
                  />
                )}
                <h3>
                  {advancedSection === "menu"
                    ? tr("Advanced", "متقدم")
                    : advancedSection === "intelligence"
                      ? tr("Code help", "مساعدة الكود")
                      : advancedSection === "runtimes"
                        ? tr("Python", "Python")
                        : advancedSection === "mcp"
                          ? "MCP"
                          : tr("Debug", "التصحيح")}
                </h3>
                <IconButton
                  icon="x"
                  label="Close Advanced"
                  onClick={() => {
                    setAdvanced(false);
                    setAdvancedSection("menu");
                  }}
                />
              </div>
              {advancedSection === "menu" && (
                <div className="advanced-menu">
                  {[
                    ["activity", "debug", tr("Debug", "التصحيح")],
                    ["zap", "intelligence", tr("Code help", "مساعدة الكود")],
                    ["cpu", "runtimes", tr("Python", "Python")],
                    ["share-2", "mcp", "MCP"],
                  ].map(([i, key, x]) => (
                    <button
                      key={x}
                      onClick={() =>
                        setAdvancedSection(key as typeof advancedSection)
                      }
                    >
                      <FeatherIcon icon={i as never} size="18" />
                      <span>{x}</span>
                      <FeatherIcon icon="chevron-right" size="16" />
                    </button>
                  ))}
                </div>
              )}
              {advancedSection === "debug" && (
                <div className="advanced-content">
                  <p>
                    Run the active Python file with the standard interactive
                    debugger.
                  </p>
                  <button
                    className="primary advanced-action"
                    disabled={
                      running || !runtime || !active?.name.endsWith(".py")
                    }
                    onClick={debug}
                  >
                    <FeatherIcon icon="activity" size="14" />
                    Start debugging
                  </button>
                </div>
              )}
              {advancedSection === "intelligence" && (
                <div className="advanced-content">
                  <Toggle
                    label="Suggestions & parameters"
                    value={suggestions}
                    set={setSuggestions}
                  />
                  <Toggle
                    label="Wrap long lines"
                    value={wordWrap}
                    set={setWordWrap}
                  />
                  <Toggle
                    label="Code minimap"
                    value={minimap}
                    set={setMinimap}
                  />
                  <p>
                    Syntax detection covers Monaco's built-in languages,
                    including Swift and SwiftUI files. TypeScript and JavaScript
                    include deeper code assistance.
                  </p>
                </div>
              )}
              {advancedSection === "runtimes" && (
                <div className="advanced-content advanced-runtime-content">
                  <p>
                    Existing venv, virtualenv, Poetry, tox, and Conda
                    environments inside the project are detected and selected
                    automatically. Run, Debug, Terminal, packages, and the agent
                    share the selected interpreter.
                  </p>
                  <div className="advanced-action-grid">
                    <button
                      className="secondary-action"
                      onClick={chooseRuntime}
                    >
                      <FeatherIcon icon="hard-drive" size="16" />
                      Use installed Python
                    </button>
                    <button
                      className="secondary-action"
                      disabled={!project || !runtime}
                      onClick={() => createVenv("")}
                    >
                      <FeatherIcon icon="folder-plus" size="16" />
                      Create project .venv
                    </button>
                    <button
                      className="secondary-action"
                      disabled={!project}
                      onClick={() => {
                        void refreshRuntimes(true).then((selected) =>
                          setNotice(
                            selected?.scope === "project"
                              ? `Using ${runtimeLabel(selected)}`
                              : "No project environment found; the bundled Python runtime is ready",
                          ),
                        );
                      }}
                    >
                      <FeatherIcon icon="refresh-cw" size="16" />
                      Rescan project
                    </button>
                  </div>
                  {project && (
                    <section className="advanced-subsection project-environment-settings">
                      <span className="settings-label">
                        PROJECT ENVIRONMENTS
                      </span>
                      <label className="advanced-select-row">
                        <span>Active environment</span>
                        <select
                          className="runtime-select"
                          value={runtime}
                          onChange={(event) =>
                            chooseRuntimeValue(event.target.value)
                          }
                        >
                          {runtimeOptions}
                          <option value="more">Download more…</option>
                        </select>
                      </label>
                      <div className="named-env">
                        <input
                          className="field"
                          aria-label="New environment name"
                          placeholder="Environment name"
                          value={envName}
                          onChange={(event) => setEnvName(event.target.value)}
                        />
                        <button
                          className="primary"
                          disabled={!envName.trim()}
                          onClick={() => createVenv(envName)}
                        >
                          Create
                        </button>
                      </div>
                      <p>
                        The selected environment is shared by Run, Debug, and
                        Terminal. Named environments are created in the project.
                        PyPI packages use osCode's bundled uv installer, so pip
                        does not need to be installed globally. Existing Conda
                        environments remain supported when their interpreter is
                        selected.
                      </p>
                    </section>
                  )}
                  <section className="advanced-subsection runtime-catalog">
                    <span className="settings-label">AVAILABLE PYTHON</span>
                    {["3.10", "3.11", "3.12", "3.13", "3.14"].map((v) => {
                      const found = runtimes.find((r) => r.version === v);
                      return (
                        <div className="runtime-row" key={v}>
                          <span>
                            Python {v}
                            {v === "3.14" ? " · latest" : ""}
                          </span>
                          {found?.installed ? (
                            <b>Ready</b>
                          ) : (
                            <button
                              disabled={!!installing}
                              onClick={() => installRuntime(v)}
                            >
                              {installing === v ? "Installing…" : "Download"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </section>
                </div>
              )}
              {advancedSection === "mcp" && (
                <div className="advanced-content mcp-settings">
                  <p>
                    Add local stdio MCP servers. Configuration is encrypted in
                    osCode app data. Servers are executable programs, so the
                    agent asks before every start or tool call and only accepts
                    tools marked read-only.
                  </p>
                  <label>
                    <span>Name</span>
                    <input
                      value={mcpName}
                      onChange={(event) => setMcpName(event.target.value)}
                      placeholder="Local documentation"
                    />
                  </label>
                  <label>
                    <span>Command</span>
                    <input
                      value={mcpCommand}
                      onChange={(event) => setMcpCommand(event.target.value)}
                      placeholder="npx"
                    />
                  </label>
                  <label>
                    <span>Arguments · one per line</span>
                    <textarea
                      value={mcpArgs}
                      onChange={(event) => setMcpArgs(event.target.value)}
                      placeholder={"-y\n@your/mcp-server"}
                      rows={3}
                    />
                  </label>
                  <button
                    className="primary advanced-action"
                    disabled={!mcpName.trim() || !mcpCommand.trim()}
                    onClick={saveMcpServer}
                  >
                    <FeatherIcon icon="plus" size="14" />
                    Add MCP server
                  </button>
                  <div className="mcp-server-list">
                    {mcpServers.map((server) => (
                      <article key={server.id}>
                        <div>
                          <b>{server.name}</b>
                          <code>
                            {server.command} {server.args.join(" ")}
                          </code>
                        </div>
                        <button
                          onClick={() =>
                            updateMcpServer(server, !server.enabled)
                          }
                        >
                          {server.enabled ? "Enabled" : "Disabled"}
                        </button>
                        <IconButton
                          icon="trash-2"
                          label={`Remove ${server.name}`}
                          onClick={() => removeMcpServer(server.id)}
                        />
                      </article>
                    ))}
                    {!mcpServers.length && (
                      <small>No MCP servers configured.</small>
                    )}
                  </div>
                  <p>
                    WebMCP is available automatically in the Agent Browser for
                    pages that expose read-only WebMCP tools.
                  </p>
                </div>
              )}
            </div>
          )}
          <button
            className="terminal-toggle"
            onClick={() => setTerminalOpen(!terminalOpen)}
          >
            <span>
              <FeatherIcon icon="terminal" size="15" />
              {tr("Terminal", "الطرفية")}
              {pythonContext && runtime && (
                <i className="env-badge" title={activeRuntimeLabel}>
                  {activeRuntimeLabel}
                </i>
              )}
            </span>
            <FeatherIcon
              icon={terminalOpen ? "chevron-down" : "chevron-up"}
              size="15"
            />
          </button>
          {terminalOpen && (
            <div className="terminal-panel">
              <div
                className="terminal-tabs"
                role="toolbar"
                aria-label="Terminal controls"
              >
                {pythonContext && (
                  <div
                    className="terminal-view-tabs"
                    aria-label="Terminal mode"
                  >
                    <button
                      type="button"
                      className={terminalView === "shell" ? "active" : ""}
                      aria-pressed={terminalView === "shell"}
                      onClick={() => setTerminalView("shell")}
                    >
                      <FeatherIcon icon="terminal" size="14" /> Shell
                    </button>
                    <button
                      type="button"
                      className={terminalView === "run" ? "active" : ""}
                      aria-pressed={terminalView === "run"}
                      onClick={() => setTerminalView("run")}
                    >
                      <FeatherIcon icon="play" size="14" /> Run output
                      {running && <i className="running-dot" />}
                    </button>
                  </div>
                )}
                {terminalView === "shell" && (
                  <div
                    className="shell-tab-strip horizontal-menu-scroll"
                    data-horizontal-menu
                    role="tablist"
                    aria-label="Shell sessions"
                  >
                    {shellTabs.map((shell) => (
                      <div
                        className={
                          shell.id === activeTerminalId ? "active" : ""
                        }
                        key={shell.id}
                      >
                        <button
                          role="tab"
                          aria-selected={shell.id === activeTerminalId}
                          onClick={() => setActiveShellId(shell.id)}
                        >
                          {shell.title}
                        </button>
                        <button
                          aria-label={`Close ${shell.title}`}
                          onClick={() => {
                            setShellTabs((current) =>
                              current.filter((item) => item.id !== shell.id),
                            );
                            if (shell.id === activeTerminalId) {
                              const other = shellTabs.find(
                                (item) => item.id !== shell.id,
                              );
                              setActiveShellId(other?.id || "");
                            }
                          }}
                        >
                          <FeatherIcon icon="x" size="13" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {terminalView === "run" && (
                  <div
                    className="terminal-run-actions horizontal-menu-scroll"
                    data-horizontal-menu
                    aria-label="Run controls"
                  >
                    <button
                      type="button"
                      onClick={() => void run()}
                      disabled={
                        running || !runtime || !active?.name.endsWith(".py")
                      }
                    >
                      <FeatherIcon icon="play" size="14" /> Run script
                    </button>
                    <button
                      type="button"
                      className="terminal-run-stop"
                      disabled={!running}
                      onClick={stopPythonProcess}
                    >
                      <FeatherIcon icon="square" size="14" /> Stop
                    </button>
                    <button
                      type="button"
                      className="terminal-clear"
                      disabled={!runOutput}
                      onClick={() => setRunOutput("")}
                    >
                      Clear
                    </button>
                  </div>
                )}
                <span className="terminal-toolbar-divider" aria-hidden="true" />
                <div
                  className="terminal-action-strip horizontal-menu-scroll"
                  data-horizontal-menu
                  role="group"
                  aria-label="Terminal actions"
                >
                  {terminalView === "shell" && (
                    <div
                      className="terminal-session-actions"
                      aria-label="Terminal session controls"
                    >
                      <IconButton
                        icon="plus"
                        label="New terminal"
                        className="terminal-session-control"
                        onClick={() => {
                          shellSequenceRef.current += 1;
                          const next = {
                            id: `shell-${globalThis.crypto.randomUUID()}`,
                            title: `Shell ${shellSequenceRef.current}`,
                            restart: 0,
                          };
                          setShellTabs((current) => [...current, next]);
                          setActiveShellId(next.id);
                        }}
                      />
                      <IconButton
                        icon="refresh-cw"
                        label="Restart terminal"
                        className="terminal-session-control"
                        disabled={!activeTerminalId}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Restart this terminal? Its current process will stop.",
                            )
                          )
                            return;
                          setShellTabs((current) =>
                            current.map((item) =>
                              item.id === activeTerminalId
                                ? { ...item, restart: item.restart + 1 }
                                : item,
                            ),
                          );
                        }}
                      />
                    </div>
                  )}
                  {pythonContext && (
                    <div className="terminal-python-tools">
                      <button
                        type="button"
                        className={pythonManagerOpen ? "active" : ""}
                        aria-expanded={pythonManagerOpen}
                        onClick={() => {
                          setPythonManagerOpen((open) => !open);
                          setUvHelpOpen(false);
                        }}
                      >
                        <FeatherIcon icon="package" size="13" /> Packages
                      </button>
                      <button
                        type="button"
                        className={uvHelpOpen ? "active" : ""}
                        aria-expanded={uvHelpOpen}
                        onClick={() => {
                          setUvHelpOpen((open) => !open);
                          setPythonManagerOpen(false);
                        }}
                      >
                        <FeatherIcon icon="book-open" size="13" /> UV help
                      </button>
                      <IconButton
                        icon="x"
                        label="Close terminal panel"
                        className="terminal-panel-close"
                        onClick={() => setTerminalOpen(false)}
                      />
                    </div>
                  )}
                  {!pythonContext && (
                    <IconButton
                      icon="x"
                      label="Close terminal panel"
                      className="terminal-panel-close"
                      onClick={() => setTerminalOpen(false)}
                    />
                  )}
                </div>
              </div>
              <div className="terminal-workspace">
                <div className="terminal-main">
                  {terminalView === "shell" ? (
                    <>
                      {shellTabs.map((shell) => (
                        <TerminalPanel
                          key={`${shell.id}-${shell.restart}`}
                          id={`${shell.id}-${shell.restart}`}
                          active={shell.id === activeTerminalId}
                          interpreter={projectEnvironment ? runtime : ""}
                          theme={theme}
                        />
                      ))}
                      {!shellTabs.length && (
                        <button
                          className="terminal-empty-action"
                          onClick={() => {
                            const next = {
                              id: `shell-${globalThis.crypto.randomUUID()}`,
                              title: `Shell ${shellSequenceRef.current}`,
                              restart: 0,
                            };
                            setShellTabs([next]);
                            setActiveShellId(next.id);
                          }}
                        >
                          Open a terminal
                        </button>
                      )}
                    </>
                  ) : (
                    <pre className="run-console">
                      {runOutput || "Run a Python file to see its output here."}
                    </pre>
                  )}
                  {terminalView === "run" && running && (
                    <form
                      className="run-input"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (!runInput) return;
                        try {
                          await window.oscode.writePython(`${runInput}\n`);
                          setRunInput("");
                        } catch (e) {
                          setNotice(
                            errorMessage(e, "Process input could not be sent"),
                          );
                        }
                      }}
                    >
                      <FeatherIcon icon="corner-down-left" size="14" />
                      <input
                        aria-label="Python process input"
                        placeholder="Send input to the running script…"
                        value={runInput}
                        onChange={(event) => setRunInput(event.target.value)}
                      />
                      <button type="submit" disabled={!runInput}>
                        Send
                      </button>
                    </form>
                  )}
                </div>
                {pythonContext && pythonManagerOpen && (
                  <aside className="python-help python-package-manager">
                    <div className="python-drawer-head">
                      <span>
                        <b>Project libraries</b>
                        <small>
                          {pythonPackageLocation === "project"
                            ? `Project ${
                                pythonPackageManager === "conda"
                                  ? "Conda"
                                  : "Python"
                              } environment · inside project`
                            : "App environment · outside project"}{" "}
                          · {pythonPackages.length} installed
                        </small>
                      </span>
                      <div
                        className="python-drawer-actions horizontal-menu-scroll"
                        data-horizontal-menu
                      >
                        <button
                          aria-label="Refresh installed Python packages"
                          disabled={Boolean(packageOperation)}
                          onClick={() => void refreshPythonPackages()}
                        >
                          <FeatherIcon icon="refresh-cw" size="15" />
                          Refresh
                        </button>
                        <button
                          aria-label="Close Python packages"
                          onClick={() => setPythonManagerOpen(false)}
                        >
                          <FeatherIcon icon="x" size="15" />
                          Close
                        </button>
                      </div>
                    </div>
                    {pythonPackageError && (
                      <div className="python-package-error" role="alert">
                        <FeatherIcon icon="alert-circle" size="17" />
                        <span>
                          <b>Python environment unavailable</b>
                          <small>{pythonPackageError}</small>
                        </span>
                      </div>
                    )}
                    <div className="python-environment-summary">
                      <span>
                        <b>
                          {pythonPackageLocation === "project"
                            ? "Using the project environment"
                            : "Using osCode application data"}
                        </b>
                        <small>
                          {activeRuntimeLabel}
                          {pythonPackageLocation === "project"
                            ? ` · PyPI packages are installed into this project's ${
                                pythonPackageManager === "conda"
                                  ? "Conda environment"
                                  : "Python environment"
                              }.`
                            : " · Packages stay outside the project folder."}
                        </small>
                      </span>
                      {pythonPackageLocation === "project" ? (
                        <button
                          type="button"
                          className="python-create-project-env"
                          disabled={!appRuntime || Boolean(packageOperation)}
                          onClick={() => {
                            if (!appRuntime) return;
                            void selectRuntime(appRuntime.path);
                            setNotice(
                              "Using an app-managed environment outside the project",
                            );
                          }}
                        >
                          <FeatherIcon icon="hard-drive" size="14" />
                          Use app environment
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="python-create-project-env"
                          disabled={Boolean(packageOperation)}
                          onClick={() => void createVenv("")}
                        >
                          <FeatherIcon icon="folder-plus" size="14" />
                          Create project .venv
                        </button>
                      )}
                    </div>
                    {packageOperation && (
                      <div
                        className="python-package-progress"
                        role="progressbar"
                        aria-label={packageOperation}
                      >
                        <span />
                        <small>{packageOperation}…</small>
                      </div>
                    )}
                    <div className="python-package-controls">
                      <form
                        className="python-package-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void installProjectPackage();
                        }}
                      >
                        <input
                          aria-label="Package to install"
                          placeholder="Package name, e.g. ultralytics"
                          value={pythonPackage}
                          disabled={
                            !project || !runtime || Boolean(packageOperation)
                          }
                          onChange={(event) =>
                            setPythonPackage(event.target.value)
                          }
                        />
                        <button
                          type="submit"
                          disabled={
                            !project ||
                            !runtime ||
                            !pythonPackage.trim() ||
                            Boolean(packageOperation)
                          }
                        >
                          <FeatherIcon icon="plus" size="15" />
                          Add
                        </button>
                      </form>
                      {!!pythonPackages.length && (
                        <label className="python-package-search">
                          <FeatherIcon icon="search" size="15" />
                          <input
                            type="search"
                            aria-label="Filter installed Python packages"
                            placeholder="Filter installed libraries"
                            value={pythonPackageSearch}
                            onChange={(event) =>
                              setPythonPackageSearch(event.target.value)
                            }
                          />
                        </label>
                      )}
                    </div>
                    {!pythonPackageEnvironment && !packageOperation && (
                      <p className="python-package-hint">
                        Add uses the selected project environment when one is
                        present. Otherwise it creates an app-managed environment
                        in osCode application data. The bundled uv installer is
                        pip-compatible across macOS, Windows, and Linux.
                      </p>
                    )}
                    <div
                      className="python-package-list"
                      aria-label="Installed Python packages"
                    >
                      {filteredPythonPackages.map((item) => (
                        <article key={item.name}>
                          <span>
                            <b>{item.name}</b>
                            <small>
                              {item.version}
                              {item.editableProjectLocation
                                ? " · editable"
                                : ""}
                            </small>
                          </span>
                          <button
                            aria-label={`Remove ${item.name}`}
                            title={`Remove ${item.name}`}
                            disabled={Boolean(packageOperation)}
                            onClick={() =>
                              void uninstallProjectPackage(item.name)
                            }
                          >
                            <FeatherIcon icon="trash-2" size="14" />
                            Remove
                          </button>
                        </article>
                      ))}
                      {!packageOperation && !pythonPackages.length && (
                        <p>
                          No libraries installed yet. Add a package here, or
                          create or open a project venv/Conda environment if you
                          want dependencies stored with the project.
                        </p>
                      )}
                      {!packageOperation &&
                        Boolean(pythonPackages.length) &&
                        !filteredPythonPackages.length && (
                          <p>No installed libraries match this search.</p>
                        )}
                    </div>
                  </aside>
                )}
                {pythonContext && uvHelpOpen && (
                  <aside className="uv-helpbook">
                    <div className="compact-panel-head">
                      <b>UV help</b>
                      <IconButton
                        icon="x"
                        label="Close UV help"
                        onClick={() => setUvHelpOpen(false)}
                      />
                    </div>
                    <input
                      autoFocus
                      type="search"
                      aria-label="Search UV help"
                      placeholder="Search UV commands"
                      value={uvHelpSearch}
                      onChange={(event) => setUvHelpSearch(event.target.value)}
                    />
                    <div>
                      {uvHelpEntries
                        .filter((entry) =>
                          entry
                            .join(" ")
                            .toLowerCase()
                            .includes(uvHelpSearch.toLowerCase()),
                        )
                        .map(([title, command, detail]) => (
                          <article key={command}>
                            <b>{title}</b>
                            <code>{command}</code>
                            <p>{detail}</p>
                          </article>
                        ))}
                    </div>
                  </aside>
                )}
              </div>
            </div>
          )}
        </main>
        {preferencesReady && (
          <>
            <div
              className="ai-resizer"
              hidden={!aiVisible}
              role="separator"
              aria-label="Resize AI chat"
              aria-orientation="vertical"
              onPointerDown={beginAiResize}
            />
            <AiPanel
              engine={aiEngine}
              model={aiModel}
              executable={aiExecutable}
              editMode={aiEditMode}
              terminalMode={aiTerminalMode}
              fileAccess={aiFileAccess}
              webAccess={aiWebAccess}
              browserAccess={aiBrowserAccess}
              computerAccess={aiComputerAccess}
              contextLimit={aiContextLimit}
              hardwarePreference={aiHardware}
              thinkingEnabled={aiThinkingEnabled}
              width={aiPanelWidth}
              side={aiPanelSide}
              projectName={project?.name || ""}
              projectKey={project?.root || project?.name || ""}
              activeFile={active && !active.media ? active.path : ""}
              visible={aiVisible}
              openChatId={requestedAiChat}
              onEngine={(next) => {
                setAiEngine(next);
                setAiModel("");
              }}
              onModel={setAiModel}
              onEditMode={setAiEditMode}
              onTerminalMode={setAiTerminalMode}
              onFileAccess={setAiFileAccess}
              onWebAccess={setAiWebAccess}
              onBrowserAccess={setAiBrowserAccess}
              onComputerAccess={setAiComputerAccess}
              onContextLimit={setAiContextLimit}
              onHardwarePreference={setAiHardware}
              onThinkingEnabled={setAiThinkingEnabled}
              onChanged={refreshAfterAiChanges}
              onNotice={setNotice}
              onChatOpened={() => {
                setRequestedAiChat("");
                if (aiAttention?.kind !== "permission")
                  handleAiAttentionChange(null);
              }}
              onAttentionChange={handleAiAttentionChange}
            />
          </>
        )}
      </div>
    </div>
  );
}
function Toggle({
  label,
  value,
  set,
}: {
  label: string;
  value: boolean;
  set: (value: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => set(e.target.checked)}
      />
      <i />
    </label>
  );
}
