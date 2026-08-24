import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { FeatherIcon } from "./components/FeatherIcon";
import { IconButton } from "./components/IconButton";
import { FileTree } from "./components/FileTree";
import { TerminalPanel } from "./components/TerminalPanel";
import { AiPanel } from "./components/AiPanel";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { PlatformioPanel } from "./components/PlatformioPanel";
import osCodeIcon from "./assets/oscode-icon.png";
import type {
  AiEditMode,
  AiEngine,
  AiInferenceHardware,
  AgentActivity,
  AgentBrowserSnapshot,
  AppUpdateStatus,
  EditorPreferences,
  GitCommit,
  GitState,
  ProjectSearchResult,
  PythonRuntime,
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
  kind?: "auto-update-prompt" | "message";
};
type FileComparison = {
  leftPath: string;
  leftName: string;
  leftContent: string;
  rightPath: string;
  rightName: string;
  rightContent: string;
};
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
      "menu" | "debug" | "intelligence" | "runtimes"
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
    [projectSearchOpen, setProjectSearchOpen] = useState(false),
    [projectSearch, setProjectSearch] = useState(""),
    [projectSearchResults, setProjectSearchResults] = useState<
      ProjectSearchResult[]
    >([]),
    [globalSearch, setGlobalSearch] = useState(""),
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
    [installingPackage, setInstallingPackage] = useState(false),
    [running, setRunning] = useState(false),
    [runOutput, setRunOutput] = useState(""),
    [runInput, setRunInput] = useState(""),
    [notice, setNotice] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pathInput, setPathInput] = useState("");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [lastProject, setLastProject] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<TreeEntry | null>(null);
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
    [sidebarWidth, setSidebarWidth] = useState(300),
    [gitHeight, setGitHeight] = useState(390),
    [aiPanelWidth, setAiPanelWidth] = useState(330),
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
    [aiFileAccess, setAiFileAccess] = useState(false),
    [aiWebAccess, setAiWebAccess] = useState(false),
    [aiBrowserAccess, setAiBrowserAccess] = useState(false),
    [aiComputerAccess, setAiComputerAccess] = useState(false),
    [aiContextLimit, setAiContextLimit] = useState(262144),
    [aiHardware, setAiHardware] = useState<AiInferenceHardware>("auto"),
    [spellcheck, setSpellcheck] = useState(true),
    [autoUpdateEnabled, setAutoUpdateEnabled] = useState(false),
    [autoUpdatePromptAnswered, setAutoUpdatePromptAnswered] = useState(false),
    [updateStatus, setUpdateStatus] = useState<AppUpdateStatus>({
      state: "disabled",
      message: "Automatic updates are off",
      currentVersion: "",
    }),
    [pythonHelpOpen, setPythonHelpOpen] = useState(true),
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
    [commitTagName, setCommitTagName] = useState("");
  const [, setMonacoReady] = useState(false);
  const monacoRef = useRef<
    typeof import("monaco-editor/editor/editor.api") | null
  >(null);
  const editorRef = useRef<
    | import("monaco-editor/editor/editor.api").editor.IStandaloneCodeEditor
    | null
  >(null);
  const editorTabsRef = useRef<HTMLDivElement | null>(null);
  const projectPickerOpen = useRef(false);
  const menuActions = useRef<Record<string, () => void>>({});
  const shortcutModifier = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";
  const active = tabs.find((t) => t.path === activePath);
  const splitLeftTab =
    tabs.find((tab) => tab.path === splitLeftPath) || active || tabs[0];
  const splitRightTab =
    tabs.find((tab) => tab.path === splitRightPath) ||
    tabs.find((tab) => tab.path !== splitLeftTab?.path) ||
    splitLeftTab;
  const dirty = active && active.content !== active.saved;
  const hasDirtyTabs = tabs.some((tab) => tab.content !== tab.saved);
  const selectedRuntime = runtimes.find((x) => x.path === runtime);
  const projectEnvironment =
    selectedRuntime?.version.startsWith("Project") || false;
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
        ].includes(entry.name.toLowerCase()),
    ),
  );
  const pythonContext =
    active?.name.toLowerCase().endsWith(".py") || pythonProject;
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
      }),
    [preferencesReady],
  );
  useEffect(() => {
    void window.oscode.appUpdateStatus().then(setUpdateStatus);
    return window.oscode.onAppUpdateStatus((status) => {
      setUpdateStatus(status);
      if (["checking", "available", "downloading"].includes(status.state)) {
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
      if (status.state === "ready" || status.state === "error")
        setNotifications((current) => {
          const id = `app-update-${status.state}-${status.version || "current"}`;
          if (current.some((item) => item.id === id)) return current;
          return [
            ...current.slice(-39),
            { id, message: status.message, createdAt: Date.now() },
          ];
        });
    });
  }, []);
  useEffect(() => {
    const offOutput = window.oscode.onPlatformioOutput((data) => {
      if (/install|download|update|fetch/i.test(data))
        setActivity({
          kind: "platformio",
          label: "PlatformIO is receiving packages",
          active: true,
          network: true,
          cancellable: true,
        });
      else if (/build|upload|clean|test|monitor/i.test(data))
        setActivity({
          kind: "platformio",
          label: "PlatformIO is working locally",
          active: true,
          network: false,
          cancellable: true,
        });
    });
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
        if (!next.active) {
          setBrowserViewOpen(false);
          setBrowserSnapshot(null);
        }
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
      offOutput();
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
    if (!browserViewOpen || !browserActivity?.active) return;
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
  }, [browserActivity?.active, browserViewOpen]);
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
  useEffect(() => setNotice(""), [activePath]);
  useEffect(() => {
    if (!notice) return;
    setNotifications((current) => [
      ...current.slice(-39),
      { id: crypto.randomUUID(), message: notice, createdAt: Date.now() },
    ]);
    const timeout = window.setTimeout(() => setNotice(""), 4200);
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
    if (terminalOpen && pythonContext) setPythonHelpOpen(true);
  }, [terminalOpen, activePath, pythonContext]);
  useEffect(() => {
    if (!pythonContext && terminalView === "run") setTerminalView("shell");
  }, [pythonContext, terminalView]);
  const activateProject = async (nextProject: ProjectState) => {
    await window.oscode.stopAgentControl();
    setAiEditMode("ask");
    setAiFileAccess(false);
    setAiWebAccess(false);
    setAiBrowserAccess(false);
    setAiComputerAccess(false);
    setBrowserActivity(null);
    setBrowserViewOpen(false);
    setBrowserSnapshot(null);
    setProject(nextProject);
    setSelectedEntry(null);
    setProjectOperation(null);
    setTabs([]);
    setActivePath("");
    setComparison(null);
    setCompareOpen(false);
    setTerminalOpen(false);
    setRunning(false);
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
      const content = await window.oscode.readFile(e.path);
      setTabs((x) => [
        ...x,
        { path: e.path, name: e.name, content, saved: content },
      ]);
      setActivePath(e.path);
    } catch {
      setNotice("This file cannot be shown as text.");
    }
  };
  const toggleSplitView = () => {
    if (!active) return;
    if (editorView === "split") {
      setEditorView("single");
      return;
    }
    setSplitLeftPath(active.path);
    setSplitRightPath((current) =>
      tabs.some((tab) => tab.path === current && current !== active.path)
        ? current
        : tabs.find((tab) => tab.path !== active.path)?.path || active.path,
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
  const searchWholeProject = async () => {
    if (!projectSearch.trim()) {
      setProjectSearchResults([]);
      return;
    }
    try {
      setProjectSearchResults(await window.oscode.searchProject(projectSearch));
    } catch (error) {
      setNotice(errorMessage(error, "Project search failed"));
    }
  };
  const searchEverything = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query || !project) {
      setGlobalSearchResults({ code: [], chats: [] });
      return;
    }
    try {
      const [code, state] = await Promise.all([
        window.oscode.searchProject(query),
        window.oscode.aiAgentState(),
      ]);
      const needle = query.toLowerCase();
      const chats = state.chats
        .slice()
        .reverse()
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
            preview: (match?.content || "Chat title match").slice(0, 180),
          };
        });
      setGlobalSearchResults({ code: code.slice(0, 80), chats });
    } catch (error) {
      setNotice(errorMessage(error, "Search failed"));
    }
  };
  useEffect(() => {
    const timeout = window.setTimeout(
      () => void searchEverything(globalSearch),
      180,
    );
    return () => window.clearTimeout(timeout);
  }, [globalSearch, project?.root]);
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
    setAiFileAccess(false);
    setAiWebAccess(false);
    setAiBrowserAccess(false);
    setAiComputerAccess(false);
    setLastProject("");
    setPathInput("");
    setSelectedEntry(null);
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
    const closing = tabs.find((tab) => tab.path === path);
    if (!closing) return;
    if (
      closing.content !== closing.saved &&
      !(await window.oscode.confirmDiscardChanges(
        `Closing “${closing.name}” will discard its unsaved changes.`,
      ))
    )
      return;
    const remaining = tabs.filter((tab) => tab.path !== path);
    setTabs(remaining);
    if (path === activePath) setActivePath(remaining.at(-1)?.path || "");
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
  const trashSelectedEntry = async () => {
    if (!project || !selectedEntry) return;
    try {
      const removedPath = selectedEntry.path;
      const hasUnsavedChanges = tabs.some(
        (tab) =>
          entryContains(removedPath, tab.path) && tab.content !== tab.saved,
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
  const save = async () => {
    if (!active) return false;
    try {
      await window.oscode.writeFile(active.path, active.content);
      setTabs((x) =>
        x.map((t) => (t.path === active.path ? { ...t, saved: t.content } : t)),
      );
      const state = await window.oscode.gitState();
      setGit(state);
      setRemote(state.remote);
      setNotice("Saved");
      return true;
    } catch (e) {
      setNotice(errorMessage(e, "File could not be saved"));
      return false;
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
    const preferred =
      found.find((x) => x.path === saved) ||
      (preferProject
        ? found.find((x) => x.version.startsWith("Project"))
        : undefined);
    setRuntime(
      (current) =>
        preferred?.path ||
        (current && found.some((x) => x.path === current)
          ? current
          : found.find((x) => x.version === "3.12" && x.installed)?.path ||
            found.find((x) => x.installed)?.path ||
            ""),
    );
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
        setAiVisible(false);
        setAiEngine(preferences.aiEngine);
        setAiModel(preferences.aiModel);
        setAiExecutable(preferences.aiExecutable);
        setAiEditMode("ask");
        setAiFileAccess(false);
        setAiWebAccess(false);
        setAiContextLimit(preferences.aiContextLimit);
        setAiHardware(preferences.aiHardware);
        setSuggestions(preferences.suggestions);
        setWordWrap(preferences.wordWrap);
        setProseWrap(preferences.proseWrap);
        setMinimap(preferences.minimap);
        setSpellcheck(preferences.spellcheck);
        setAutoUpdateEnabled(preferences.autoUpdateEnabled);
        setAutoUpdatePromptAnswered(preferences.autoUpdatePromptAnswered);
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
      version: 9,
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
      suggestions,
      wordWrap,
      proseWrap,
      minimap,
      spellcheck,
      autoUpdateEnabled,
      autoUpdatePromptAnswered,
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
    suggestions,
    wordWrap,
    proseWrap,
    minimap,
    spellcheck,
    autoUpdateEnabled,
    autoUpdatePromptAnswered,
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
  const installProjectPackage = async () => {
    const packageSpec = pythonPackage.trim();
    if (!packageSpec || !projectEnvironment) return;
    setInstallingPackage(true);
    try {
      const installed = await window.oscode.installPythonPackage(
        runtime,
        packageSpec,
      );
      setPythonPackage("");
      setNotice(`${installed.package} installed in this project environment`);
    } catch (e) {
      setNotice(errorMessage(e, "Package installation failed"));
    } finally {
      setInstallingPackage(false);
    }
  };
  const selectRuntime = async (value: string) => {
    setRuntime(value);
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
  menuActions.current = {
    "open-project": () => void openProject(),
    "new-file": () => {
      if (project) beginProjectOperation("file");
      else setNotice("Open a project before creating a file");
    },
    save: () => {
      if (active) void save();
      else setNotice("Open a file before saving");
    },
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
  };
  const runtimeOptions = useMemo(
    () =>
      runtimes.map((r) => (
        <option
          key={`${r.version}:${r.path}`}
          value={r.installed ? r.path : `download:${r.version}`}
          disabled={Boolean(installing)}
        >
          Python {r.version}
          {r.installed
            ? ""
            : installing === r.version
              ? " · installing…"
              : " · download"}
        </option>
      )),
    [installing, runtimes],
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
    if (!(await refreshAgentBrowserView())) return;
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
        if (!changed.has(relative) || tab.content !== tab.saved) return tab;
        const content = await window.oscode.readFile(tab.path);
        return { ...tab, content, saved: content };
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
    setAutoUpdateEnabled(enabled);
    setAutoUpdatePromptAnswered(true);
    setNotifications((current) =>
      current.filter((item) => item.kind !== "auto-update-prompt"),
    );
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
  return (
    <div
      className={`app ${theme}`}
      data-platform={window.oscode.platform}
      dir={locale === "ar" ? "rtl" : "ltr"}
    >
      <div className="mac-titlebar-safe-area" aria-hidden="true" />
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
          <label className="global-search">
            <FeatherIcon icon="search" size="17" />
            <input
              type="search"
              value={globalSearch}
              disabled={!project}
              aria-label="Search project and AI chats"
              placeholder={
                project ? "Search code and chats" : "Open a project to search"
              }
              onChange={(event) => setGlobalSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setGlobalSearch("");
              }}
            />
          </label>
          {browserActivity?.active && (
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
              {activity && (
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
        <div className="top-actions">
          {pythonContext && (
            <>
              <select
                className="runtime-select"
                value={runtime}
                onChange={(e) => chooseRuntimeValue(e.target.value)}
                aria-label="Python interpreter"
              >
                {runtimeOptions}
                <option value="more">Download more…</option>
              </select>
              <IconButton
                icon="play"
                label="Run"
                onClick={run}
                disabled={running || !runtime || !active?.name.endsWith(".py")}
              />
              <IconButton
                icon="square"
                label="Stop"
                onClick={() => {
                  window.oscode.stopPython();
                  setRunning(false);
                }}
                disabled={!running}
              />
              <span className="divider" />
            </>
          )}
          <IconButton
            icon="bell"
            label="Notifications"
            active={notificationsOpen}
            onClick={() => setNotificationsOpen((open) => !open)}
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
            active={aiVisible}
            onClick={() => setAiVisible((visible) => !visible)}
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
            }}
          />
        </div>
      </header>
      {notificationsOpen && (
        <div className="notifications-popover" aria-label="Notifications">
          <div>
            <h2>Notifications</h2>
            <span className="notification-actions">
              <button
                onClick={() =>
                  setNotifications((current) =>
                    current.filter(
                      (item) => item.kind === "auto-update-prompt",
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
          {notifications.length ? (
            notifications
              .slice()
              .reverse()
              .map((item) => (
                <div
                  className={`notification-row ${item.kind === "auto-update-prompt" ? "update-prompt" : ""}`}
                  key={item.id}
                >
                  <span>
                    {item.message}
                    <time dateTime={new Date(item.createdAt).toISOString()}>
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                  </span>
                  {item.kind === "auto-update-prompt" ? (
                    <div className="notification-choice">
                      <button
                        onClick={() => void chooseAutomaticUpdates(false)}
                      >
                        Keep off
                      </button>
                      <button
                        className="primary"
                        onClick={() => void chooseAutomaticUpdates(true)}
                      >
                        Turn on
                      </button>
                    </div>
                  ) : (
                    <button
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
            <p>No notifications.</p>
          )}
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
            <div className="git-commit-quick-actions">
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
                    onClick={openProject}
                  />
                </div>
                {project && (
                  <>
                    <div className="explorer-toolbar">
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
                        icon="search"
                        label="Search project"
                        active={projectSearchOpen}
                        onClick={() => setProjectSearchOpen((open) => !open)}
                      />
                      <IconButton
                        icon="x-circle"
                        label="Close and forget project"
                        onClick={() => void closeProject()}
                      />
                    </div>
                    {projectSearchOpen && (
                      <div className="project-search-panel">
                        <div className="compact-panel-head">
                          <b>Search project</b>
                          <IconButton
                            icon="x"
                            label="Close project search"
                            onClick={() => setProjectSearchOpen(false)}
                          />
                        </div>
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void searchWholeProject();
                          }}
                        >
                          <input
                            autoFocus
                            aria-label="Search all project files"
                            placeholder="Search text"
                            value={projectSearch}
                            onChange={(event) =>
                              setProjectSearch(event.target.value)
                            }
                          />
                          <button
                            type="submit"
                            disabled={!projectSearch.trim()}
                          >
                            Search
                          </button>
                        </form>
                        <div className="project-search-results">
                          {projectSearchResults.map((result) => (
                            <button
                              key={`${result.path}:${result.line}`}
                              onClick={() => {
                                setPendingRevealLine(result.line);
                                setProjectSearchOpen(false);
                                void openFile({
                                  path: result.path,
                                  name:
                                    result.relativePath.split("/").at(-1) ||
                                    result.relativePath,
                                  kind: "file",
                                });
                              }}
                            >
                              <b>
                                {result.relativePath}:{result.line}
                              </b>
                              <span>{result.preview}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
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
                  <div className="tree">
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
                            <small>
                              {git.remote
                                ? `${git.ahead} unpushed · ${git.behind} incoming`
                                : "local only"}
                            </small>
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
                          <div className="git-branch-controls">
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
                          <div className="git-utility-actions">
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
                          <div className="git-remote-actions">
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
            className="tabs"
            ref={editorTabsRef}
            onWheel={(event) => {
              const strip = event.currentTarget;
              if (strip.scrollWidth <= strip.clientWidth) return;
              strip.scrollLeft += event.deltaY || event.deltaX;
            }}
          >
            {browserViewOpen && (
              <button
                className={`tab browser-tab ${activePath === agentBrowserTabPath ? "active" : ""}`}
                onClick={() => setActivePath(agentBrowserTabPath)}
              >
                <FeatherIcon icon="compass" size="14" />
                <span>Agent browser</span>
                {browserSnapshot?.loading && <i />}
                <FeatherIcon
                  icon="x"
                  size="13"
                  onClick={(event) => {
                    event.stopPropagation();
                    setBrowserViewOpen(false);
                  }}
                />
              </button>
            )}
            {tabs.map((t) => (
              <button
                className={`tab ${t.path === activePath ? "active" : ""}`}
                onClick={() => setActivePath(t.path)}
                key={t.path}
              >
                <span>{t.name}</span>
                {t.content !== t.saved && <i />}
                <FeatherIcon
                  icon="x"
                  size="13"
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeTab(t.path);
                  }}
                />
              </button>
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
                <div className="agent-browser-actions">
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
          ) : active ? (
            <>
              <div
                className="editor-command-bar"
                role="toolbar"
                aria-label="Editor commands"
              >
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
                  className="markdown-toolbar"
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
                              "editor.background": "#111719",
                              "editorLineNumber.foreground": "#60727A",
                              "editorCursor.foreground": "#89cff0",
                              "editor.selectionBackground": "#294855",
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
                      tabs={tabs}
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
                  <button className="primary" onClick={openProject}>
                    <FeatherIcon icon="folder" size="15" />
                    {tr("Open a project", "فتح مشروع")}
                  </button>
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
                    {tr("Grey + blue", "رمادي وأزرق")}
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
                {autoUpdateEnabled && (
                  <button
                    className="settings-update-check"
                    disabled={
                      updateStatus.state === "checking" ||
                      updateStatus.state === "downloading"
                    }
                    onClick={async () => {
                      try {
                        setUpdateStatus(
                          await window.oscode.checkForAppUpdate(),
                        );
                      } catch (error) {
                        setNotice(errorMessage(error, "Update check failed"));
                      }
                    }}
                  >
                    <FeatherIcon icon="refresh-cw" size="15" />
                    {tr("Check now", "تحقق الآن")}
                  </button>
                )}
              </section>
              <section>
                <span className="settings-label">
                  {tr("PRIVACY", "الخصوصية")}
                </span>
                <p className="settings-note">
                  {tr(
                    "Chats and settings are encrypted in application data.",
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
            <div className="advanced-dock">
              <div className="advanced-title">
                {advancedSection !== "menu" && (
                  <button onClick={() => setAdvancedSection("menu")}>
                    <FeatherIcon icon="arrow-left" size="14" />
                  </button>
                )}
                <span className="eyebrow">
                  {advancedSection === "menu"
                    ? tr("ADVANCED", "متقدم")
                    : advancedSection.toUpperCase()}
                </span>
                <IconButton
                  icon="x"
                  label="Close Advanced"
                  onClick={() => {
                    setAdvanced(false);
                    setAdvancedSection("menu");
                  }}
                />
              </div>
              {advancedSection === "menu" &&
                [
                  ["activity", "debug", tr("Debug", "التصحيح")],
                  ["zap", "intelligence", tr("Code help", "مساعدة الكود")],
                  ["cpu", "runtimes", tr("Python", "Python")],
                ].map(([i, key, x]) => (
                  <button
                    key={x}
                    onClick={() =>
                      setAdvancedSection(key as typeof advancedSection)
                    }
                  >
                    <FeatherIcon icon={i as never} size="15" />
                    {x}
                    <FeatherIcon icon="chevron-right" size="13" />
                  </button>
                ))}
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
                <div className="advanced-content">
                  <p>Choose Python or create a private project environment.</p>
                  <button className="secondary-action" onClick={chooseRuntime}>
                    Use installed Python
                  </button>
                  <button
                    className="secondary-action"
                    disabled={!project || !runtime}
                    onClick={createVenv}
                  >
                    Create .venv
                  </button>
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
                </div>
              )}
            </div>
          )}
          {advanced && advancedSection === "runtimes" && project && (
            <div className="env-manager-addon">
              <span className="eyebrow">PROJECT ENVIRONMENTS</span>
              <select
                className="runtime-select"
                value={runtime}
                onChange={(e) => chooseRuntimeValue(e.target.value)}
              >
                {runtimeOptions}
                <option value="more">Download more…</option>
              </select>
              <button
                className="secondary-action"
                onClick={() => createVenv("")}
              >
                Use local .venv
              </button>
              <div className="named-env">
                <input
                  className="field"
                  aria-label="New environment name"
                  placeholder="Environment name"
                  value={envName}
                  onChange={(e) => setEnvName(e.target.value)}
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
                The selected environment is applied to Run, Debug, and Terminal.
                Package installs stay inside this project.
              </p>
            </div>
          )}
          <button
            className="terminal-toggle"
            onClick={() => setTerminalOpen(!terminalOpen)}
          >
            <span>
              <FeatherIcon icon="terminal" size="15" />
              {tr("Terminal", "الطرفية")}
              {projectEnvironment && (
                <i className="env-badge">
                  {selectedRuntime?.version
                    .replace("Project: ", "")
                    .replace("Project .venv", ".venv")}
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
                role="tablist"
                aria-label="Terminal views"
              >
                {pythonContext && (
                  <button
                    type="button"
                    className={terminalView === "shell" ? "active" : ""}
                    onClick={() => setTerminalView("shell")}
                  >
                    Shell
                  </button>
                )}
                {pythonContext && (
                  <button
                    type="button"
                    className={terminalView === "run" ? "active" : ""}
                    onClick={() => setTerminalView("run")}
                  >
                    Run {running && <i className="running-dot" />}
                  </button>
                )}
                {terminalView === "shell" && (
                  <div className="shell-tab-strip" aria-label="Shell sessions">
                    {shellTabs.map((shell) => (
                      <div
                        className={
                          shell.id === activeTerminalId ? "active" : ""
                        }
                        key={shell.id}
                      >
                        <button onClick={() => setActiveShellId(shell.id)}>
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
                    <div
                      className="terminal-session-actions"
                      aria-label="Terminal session controls"
                    >
                      <IconButton
                        icon="plus"
                        label="New terminal"
                        onClick={() => {
                          const next = {
                            id: `shell-${globalThis.crypto.randomUUID()}`,
                            title: `Shell ${shellTabs.length + 1}`,
                            restart: 0,
                          };
                          setShellTabs((current) => [...current, next]);
                          setActiveShellId(next.id);
                        }}
                      />
                      <IconButton
                        icon="refresh-cw"
                        label="Restart terminal"
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
                  </div>
                )}
                {terminalView === "run" && (
                  <button
                    type="button"
                    className="terminal-clear"
                    disabled={!runOutput}
                    onClick={() => setRunOutput("")}
                  >
                    Clear
                  </button>
                )}
                {pythonContext && !pythonHelpOpen && (
                  <button
                    type="button"
                    className="terminal-help-button"
                    onClick={() => setPythonHelpOpen(true)}
                  >
                    <FeatherIcon icon="help-circle" size="13" /> Python help
                  </button>
                )}
                <IconButton
                  icon="x"
                  label="Close terminal panel"
                  onClick={() => setTerminalOpen(false)}
                />
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
                              title: "Shell 1",
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
                {pythonContext && pythonHelpOpen && (
                  <aside className="python-help">
                    <div>
                      <b>Python packages</b>
                      <button
                        aria-label="Close Python help"
                        onClick={() => setPythonHelpOpen(false)}
                      >
                        <FeatherIcon icon="x" size="14" />
                      </button>
                    </div>
                    <p>Create a project environment first, then use:</p>
                    <form
                      className="python-package-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void installProjectPackage();
                      }}
                    >
                      <input
                        aria-label="Python package"
                        placeholder="requests==2.32.5"
                        value={pythonPackage}
                        disabled={!projectEnvironment || installingPackage}
                        onChange={(event) =>
                          setPythonPackage(event.target.value)
                        }
                      />
                      <button
                        type="submit"
                        disabled={
                          !projectEnvironment ||
                          !pythonPackage.trim() ||
                          installingPackage
                        }
                      >
                        {installingPackage ? "Installing…" : "Install"}
                      </button>
                    </form>
                    {!projectEnvironment && (
                      <small>
                        Select or create a project environment above.
                      </small>
                    )}
                    <code>uv add requests</code>
                    <small>Add a package to a uv project.</small>
                    <code>uv pip install requests</code>
                    <small>Install into the active .venv.</small>
                    <code>python -m pip list</code>
                    <small>Show installed packages.</small>
                  </aside>
                )}
              </div>
            </div>
          )}
        </main>
        {aiVisible && preferencesReady && (
          <>
            <div
              className="ai-resizer"
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
              fileAccess={aiFileAccess}
              webAccess={aiWebAccess}
              browserAccess={aiBrowserAccess}
              computerAccess={aiComputerAccess}
              contextLimit={aiContextLimit}
              hardwarePreference={aiHardware}
              width={aiPanelWidth}
              side={aiPanelSide}
              projectName={project?.name || ""}
              openChatId={requestedAiChat}
              onEngine={(next) => {
                setAiEngine(next);
                setAiModel("");
              }}
              onModel={setAiModel}
              onEditMode={setAiEditMode}
              onFileAccess={setAiFileAccess}
              onWebAccess={setAiWebAccess}
              onBrowserAccess={setAiBrowserAccess}
              onComputerAccess={setAiComputerAccess}
              onContextLimit={setAiContextLimit}
              onHardwarePreference={setAiHardware}
              onChanged={refreshAfterAiChanges}
              onNotice={setNotice}
              onChatOpened={() => setRequestedAiChat("")}
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
