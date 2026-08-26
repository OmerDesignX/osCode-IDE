export type TreeEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: TreeEntry[];
};
export type EditorPreferences = {
  version: 10;
  theme: "dark" | "blue-dark" | "blue-light";
  locale: "en" | "ar";
  sidebarSide: "left" | "right";
  uiScale: 1 | 1.15 | 1.3 | 1.5 | 1.7;
  editorFontSize: number;
  sidebarWidth: number;
  gitHeight: number;
  aiPanelWidth: number;
  sidebarVisible: boolean;
  aiVisible: boolean;
  aiEngine: AiEngine;
  aiModel: string;
  aiExecutable: string;
  aiEditMode: AiEditMode;
  aiFileAccess: boolean;
  aiWebAccess: boolean;
  aiContextLimit: number;
  aiHardware: AiInferenceHardware;
  suggestions: boolean;
  wordWrap: boolean;
  proseWrap: boolean;
  minimap: boolean;
  spellcheck: boolean;
  autoSave: boolean;
  autoUpdateEnabled: boolean;
  autoUpdatePromptAnswered: boolean;
  lastProject: string;
};
export type AppUpdateStatus = {
  state:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "current"
    | "error"
    | "unsupported";
  message: string;
  currentVersion: string;
  version?: string;
  percent?: number;
};
export type AiEngine = "llamacpp" | "ollama" | "pytorch" | "mlx";
export type AiInferenceHardware = "auto" | "cpu" | "gpu";
export type AiEditMode = "ask" | "auto" | "read-only";
export type AiTerminalMode = "ask" | "auto";
export type AiModel = {
  id: string;
  name: string;
  engine: AiEngine;
  path: string;
  source: "local" | "downloaded" | "available" | "ollama" | "bundled";
  tier?: AiModelTier;
  bytes?: number;
  supported?: boolean;
  supportReason?: string;
  contextLimit?: number;
  preferredContext?: number;
  installed?: boolean;
  downloadBytes?: number;
};
export type AiModelTier = "small" | "medium" | "large" | "custom";
export type AiPipelineState = {
  state: "idle" | "waiting" | "running";
  label: string;
  position: number;
  activeProject: string;
};
export type OllamaCliStatus = {
  installed: boolean;
  managed: boolean;
  version: string;
  message: string;
};
export type AiPermissionKind =
  | "project.read"
  | "project.write"
  | "terminal.run"
  | "packages.install"
  | "debug.run"
  | "web.search"
  | "browser.control"
  | "computer.control"
  | "platformio.run";
export type AiPermissionScope = "once" | "conversation" | "always";
export type AiPermissionGrant = {
  id: string;
  kind: AiPermissionKind;
  scope: AiPermissionScope;
  chatId: string;
  projectRoot: string;
  createdAt: string;
  detail: string;
};
export type AiPermissionRequest = {
  id: string;
  kind: AiPermissionKind;
  title: string;
  detail: string;
};
export type AiChatAttachment = {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  dataUrl: string;
};
export type AiActionKind =
  | "plan"
  | "permission"
  | "web"
  | "browser"
  | "computer"
  | "files"
  | "command"
  | "goal"
  | "result";
export type AiActionStatus =
  "running" | "completed" | "waiting" | "failed" | "denied";
export type AiActionEntry = {
  id: string;
  chatId: string;
  kind: AiActionKind;
  status: AiActionStatus;
  title: string;
  detail?: string;
  tool?: string;
  query?: string;
  url?: string;
  target?: string;
  websites?: string[];
  createdAt: string;
  completedAt?: string;
};
export type AiChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  createdAt?: string;
  assistantName?: "osCode" | "Custom Model";
  attachments?: AiChatAttachment[];
  actions?: AiActionEntry[];
};
export type AiChatThread = {
  id: string;
  title: string;
  projectRoot: string;
  messages: AiChatMessage[];
  contextSummary: string;
  createdAt: string;
  updatedAt: string;
};
export type AiGoal = {
  id: string;
  chatId: string;
  text: string;
  status: "active" | "complete";
  automatic: boolean;
  createdAt: string;
};
export type AiQueueItem = {
  id: string;
  chatId: string;
  prompt: string;
  status: "queued" | "running" | "complete" | "failed";
  createdAt: string;
  runAt?: string;
  automatic?: boolean;
};
export type AiSchedule = {
  id: string;
  chatId: string;
  prompt: string;
  cadence: "once" | "daily" | "weekly";
  nextRunAt: string;
  enabled: boolean;
  createdAt: string;
  automatic?: boolean;
};
export type AiAgentState = {
  chats: AiChatThread[];
  goals: AiGoal[];
  queue: AiQueueItem[];
  schedules: AiSchedule[];
  permissions: AiPermissionGrant[];
};
export type AiHardwareProfile = {
  platform: string;
  arch: string;
  memoryBytes: number;
  engine: "llamacpp" | "mlx";
  recommendedTier: Exclude<AiModelTier, "custom">;
  gpuAvailable: boolean;
  gpuName: string;
  accelerator: "metal" | "vulkan" | "cuda" | "none";
  acceleratorVersion?: string;
  nvidiaDetected?: boolean;
  nvidiaDriverVersion?: string;
  nvidiaCudaVersion?: string;
  cudaRuntimeAvailable?: boolean;
  cudaInstallSupported?: boolean;
  cudaMessage?: string;
  pytorchCudaMessage?: string;
};
export type GitCommit = {
  id: string;
  shortId: string;
  subject: string;
  author: string;
  date: string;
  state: "local" | "unpushed" | "pushed";
};
export type AiChatResponse = {
  content: string;
  thinking?: string;
  retainedMessages?: AiChatMessage[];
  changedFiles: string[];
  toolSteps: string[];
  actions: AiActionEntry[];
  pendingEdits: Array<{ id: string; path: string }>;
  contextSummary: string;
  usage: { used: number; limit: number; compacted: boolean };
  permissionRequest?: AiPermissionRequest;
};
export type AiHistoryEntry = {
  id: string;
  createdAt: string;
  path: string;
  before: string | null;
  after: string;
  summary: string;
};
export type GitFile = {
  path: string;
  originalPath?: string;
  index: string;
  workingTree: string;
};
export type GitState = {
  initialized: boolean;
  branch: string;
  branches: string[];
  ahead: number;
  behind: number;
  remote: string;
  userName: string;
  userEmail: string;
  files: GitFile[];
  submodules: Array<{ path: string; url: string }>;
  stashes: Array<{ ref: string; message: string }>;
  tags: string[];
  commits: GitCommit[];
};
export type PythonRuntime = {
  version: string;
  path: string;
  installed: boolean;
  scope?: "app" | "app-project" | "project" | "system";
};
export type PythonPackage = {
  name: string;
  version: string;
  editableProjectLocation?: string;
};
export type PythonPackageState = {
  interpreter: string;
  environment: string;
  location: "" | "app" | "project";
  packages: PythonPackage[];
};
export type PlatformioState = {
  installed: boolean;
  version: string;
  project: boolean;
  environments: string[];
  autoUpdate: boolean;
  running: boolean;
  telemetry: false;
};
export type PlatformioAction =
  "build" | "upload" | "clean" | "test" | "monitor";
export type PlatformioBoard = {
  id: string;
  name: string;
  platform: string;
  frameworks: string[];
};
export type ProjectSearchResult = {
  path: string;
  relativePath: string;
  line: number;
  preview: string;
};
export type ProjectFileChange = {
  path: string;
  kind: "change" | "rename";
  exists: boolean;
};
export type SaveHistoryEntry = {
  id: string;
  createdAt: string;
  path: string;
  source: "manual" | "autosave" | "agent" | "restore";
  bytes: number;
};
export type Tab = {
  path: string;
  name: string;
  content: string;
  saved: string;
};
declare global {
  interface Window {
    oscode: {
      platform: string;
      setDirtyState(dirty: boolean): void;
      confirmDiscardChanges(detail: string): Promise<boolean>;
      openProject(): Promise<{
        root: string;
        name: string;
        tree: TreeEntry[];
      } | null>;
      openProjectPath(
        path: string,
      ): Promise<{ root: string; name: string; tree: TreeEntry[] }>;
      closeProject(): Promise<boolean>;
      refreshProject(): Promise<TreeEntry[]>;
      searchProject(query: string): Promise<ProjectSearchResult[]>;
      listDirectory(path: string): Promise<TreeEntry[]>;
      createProjectItem(
        directory: string,
        name: string,
        kind: "file" | "folder",
      ): Promise<{ tree: TreeEntry[]; item: TreeEntry }>;
      renameProjectItem(
        path: string,
        name: string,
      ): Promise<{ tree: TreeEntry[]; newPath: string; name: string }>;
      trashProjectItem(
        path: string,
        hasUnsavedChanges?: boolean,
      ): Promise<{ deleted: boolean; tree: TreeEntry[] }>;
      loadPreferences(): Promise<EditorPreferences>;
      savePreferences(preferences: EditorPreferences): Promise<boolean>;
      openSecureData(): Promise<string>;
      onPreferencesChanged(
        cb: (preferences: EditorPreferences) => void,
      ): () => void;
      appUpdateStatus(): Promise<AppUpdateStatus>;
      setAppAutoUpdate(enabled: boolean): Promise<AppUpdateStatus>;
      checkForAppUpdate(): Promise<AppUpdateStatus>;
      onAppUpdateStatus(cb: (status: AppUpdateStatus) => void): () => void;
      setZoomFactor(factor: number): void;
      platformioState(): Promise<PlatformioState>;
      platformioBoards(): Promise<PlatformioBoard[]>;
      installPlatformio(): Promise<PlatformioState>;
      updatePlatformio(): Promise<PlatformioState>;
      setPlatformioAutoUpdate(enabled: boolean): Promise<PlatformioState>;
      initializePlatformio(
        board: string,
        framework: string,
      ): Promise<PlatformioState>;
      runPlatformio(
        action: PlatformioAction,
        environment: string,
      ): Promise<PlatformioState>;
      stopPlatformio(): Promise<boolean>;
      writePlatformio(data: string): Promise<boolean>;
      onPlatformioOutput(cb: (data: string) => void): () => void;
      onPlatformioState(cb: (state: PlatformioState) => void): () => void;
      listAiModels(): Promise<AiModel[]>;
      aiHardwareProfile(): Promise<AiHardwareProfile>;
      installAiCudaSupport(): Promise<AiHardwareProfile>;
      downloadOsCodeModel(
        tier: Exclude<AiModelTier, "custom">,
      ): Promise<AiModel>;
      aiAgentState(): Promise<AiAgentState>;
      createAiChat(title?: string): Promise<AiChatThread>;
      saveAiChat(
        id: string,
        messages: AiChatMessage[],
        contextSummary: string,
      ): Promise<AiChatThread>;
      deleteAiChat(id: string): Promise<boolean>;
      setAiGoal(
        chatId: string,
        text: string,
        automatic?: boolean,
      ): Promise<AiGoal>;
      completeAiGoal(id: string): Promise<boolean>;
      removeAiGoal(id: string): Promise<boolean>;
      addAiQueue(
        chatId: string,
        prompt: string,
        runAt?: string,
      ): Promise<AiQueueItem>;
      updateAiQueue(
        id: string,
        status: AiQueueItem["status"],
      ): Promise<boolean>;
      prioritizeAiQueue(id: string): Promise<boolean>;
      removeAiQueue(id: string): Promise<boolean>;
      addAiSchedule(
        chatId: string,
        prompt: string,
        nextRunAt: string,
        cadence: AiSchedule["cadence"],
      ): Promise<AiSchedule>;
      removeAiSchedule(id: string): Promise<boolean>;
      collectDueAiSchedules(): Promise<number>;
      grantAiPermission(
        kind: AiPermissionKind,
        scope: AiPermissionScope,
        chatId: string,
        detail: string,
      ): Promise<AiPermissionGrant>;
      revokeAiPermission(id: string): Promise<boolean>;
      chooseAiModel(
        engine: AiEngine,
        kind?: "file" | "folder" | "any",
      ): Promise<AiModel[]>;
      updateAiModelContext(id: string, contextLimit: number): Promise<AiModel>;
      removeAiModel(id: string): Promise<boolean>;
      chooseAiExecutable(engine: AiEngine): Promise<string>;
      downloadAiModel(engine: AiEngine, source: string): Promise<AiModel>;
      ollamaCliStatus(): Promise<OllamaCliStatus>;
      installOllamaCli(): Promise<OllamaCliStatus>;
      prepareAiEngine(engine: AiEngine): Promise<string>;
      aiChat(request: {
        chatId: string;
        engine: AiEngine;
        model: string;
        executable: string;
        messages: AiChatMessage[];
        editMode: AiEditMode;
        terminalMode: AiTerminalMode;
        fileAccess: boolean;
        webAccess: boolean;
        browserAccess: boolean;
        computerAccess: boolean;
        resumePermission: boolean;
        contextLimit: number;
        hardware: AiInferenceHardware;
        contextSummary: string;
        goal: string;
      }): Promise<AiChatResponse>;
      resolveAiEdits(ids: string[], approve: boolean): Promise<string[]>;
      listAiHistory(): Promise<AiHistoryEntry[]>;
      revertAiHistory(id: string): Promise<string[]>;
      stopAi(): Promise<boolean>;
      stopAgentControl(): Promise<boolean>;
      agentBrowserSnapshot(): Promise<AgentBrowserSnapshot | null>;
      showAgentBrowser(): Promise<AgentBrowserSnapshot | null>;
      stopCurrentActivity(): Promise<boolean>;
      onAgentActivity(cb: (activity: AgentActivity) => void): () => void;
      onAiPipelineState(cb: (state: AiPipelineState) => void): () => void;
      onAiStatus(cb: (status: string) => void): () => void;
      onAiAction(cb: (action: AiActionEntry) => void): () => void;
      setSpellcheck(enabled: boolean): Promise<boolean>;
      onSpellcheckReplaceAll(
        cb: (word: string, replacement: string) => void,
      ): () => void;
      exportDiagram(
        action: "copy" | "save",
        format: "svg" | "png",
        data: string,
      ): Promise<boolean>;
      readMarkdownImage(markdownPath: string, source: string): Promise<string>;
      readFile(path: string): Promise<string>;
      writeFile(
        path: string,
        content: string,
        source?: "manual" | "autosave" | "agent" | "restore",
      ): Promise<boolean>;
      listSaveHistory(path: string): Promise<SaveHistoryEntry[]>;
      restoreSaveHistory(path: string, id: string): Promise<string>;
      onProjectFileChanged(cb: (change: ProjectFileChange) => void): () => void;
      gitState(): Promise<GitState>;
      gitRun(action: string, payload?: string): Promise<GitState>;
      deleteRepository(): Promise<GitState>;
      absorbSubmodule(path: string): Promise<GitState>;
      createTerminal(
        id: string,
        interpreter?: string,
      ): Promise<{ shell: string }>;
      terminalWrite(id: string, data: string): void;
      terminalResize(id: string, cols: number, rows: number): void;
      terminalDispose(id: string): Promise<boolean>;
      onTerminalData(cb: (id: string, data: string) => void): () => void;
      listPython(): Promise<PythonRuntime[]>;
      getProjectPython(): Promise<string>;
      setProjectPython(interpreter: string): Promise<boolean>;
      choosePython(): Promise<PythonRuntime | null>;
      installPython(version: string): Promise<boolean>;
      createVenv(interpreter: string, name?: string): Promise<PythonRuntime>;
      listPythonPackages(interpreter: string): Promise<PythonPackageState>;
      installPythonPackage(
        interpreter: string,
        packageSpec: string,
      ): Promise<{
        package: string;
        output: string;
        interpreter: string;
        createdEnvironment: boolean;
      }>;
      uninstallPythonPackage(
        interpreter: string,
        packageName: string,
      ): Promise<{ package: string; output: string; interpreter: string }>;
      runPython(
        file: string,
        interpreter: string,
        debug?: boolean,
      ): Promise<boolean>;
      stopPython(): Promise<boolean>;
      writePython(data: string): Promise<boolean>;
      onRunData(cb: (data: string) => void): () => void;
      onRunStopped(cb: () => void): () => void;
      onMenuAction(cb: (action: string) => void): () => void;
    };
  }
}

export type AgentActivity = {
  kind:
    | "browser"
    | "computer"
    | "download"
    | "platformio"
    | "network"
    | "security"
    | "queue";
  label: string;
  active: boolean;
  network: boolean;
  url?: string;
  target?: string;
  mode?: "oscode" | "background" | "foreground";
  progress?: number;
  cancellable?: boolean;
};

export type AgentBrowserSnapshot = {
  url: string;
  title: string;
  imageDataUrl: string;
  loading: boolean;
  capturedAt: number;
};
