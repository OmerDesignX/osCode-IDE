import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  type MenuItemConstructorOptions,
} from "electron";
import path from "node:path";
import { lstatSync, unlinkSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import * as pty from "node-pty";
import type {
  AiEngine,
  AiModel,
  GitCommit,
  GitState,
  TreeEntry,
} from "../types.js";
import { LocalAiService } from "./ai.js";
import { AgentControlService } from "./agent-control.js";
import { parseGitStatus, parseTracking } from "./git-status.js";
import { PlatformioService } from "./platformio.js";
import { defaultPreferences, validPreferences } from "./preferences.js";
import { guardBrokenOutputPipe } from "./process-output.js";
import { AppUpdateService } from "./updater.js";
import {
  setPythonSelection,
  validPythonSelections,
} from "./python-selections.js";
import {
  decodeTextFile,
  validateGitBranch,
  validateGitRemote,
  validateTerminalId,
  validateTerminalInput,
  validateTextContent,
  validTerminalSize,
} from "./security.js";

const exec = promisify(execFile);
guardBrokenOutputPipe(process.stdout);
guardBrokenOutputPipe(process.stderr);
let mainWindow: BrowserWindow | null = null;
let projectRoot = "";
const terminals = new Map<string, pty.IPty>();
const terminalDisposals = new Map<string, Promise<void>>();
let runningScript: ReturnType<typeof spawn> | null = null;
let aiService: LocalAiService;
let agentControlService: AgentControlService;
let platformioService: PlatformioService;
let appUpdateService: AppUpdateService;
let runningDebug = false;
let quittingAfterCleanup = false;
let rendererHasUnsavedChanges = false;
let closeConfirmationOpen = false;
let allowWindowClose = false;
let spellcheckEnabled = true;
function sendToRenderer(channel: string, ...args: unknown[]) {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isDestroyed()
  )
    return;
  mainWindow.webContents.send(channel, ...args);
}
const managedPythonVersions = ["3.10", "3.11", "3.12", "3.13", "3.14"];
const smokeMarker = path.join(
  path.dirname(process.execPath),
  ".oscode-smoke-test",
);
const smokeMarkerReady = (() => {
  try {
    return lstatSync(smokeMarker).isFile();
  } catch {
    return false;
  }
})();
const smokeMode =
  smokeMarkerReady ||
  process.env.OSCODE_SMOKE_TEST === "1" ||
  process.argv.includes("smoke-test") ||
  process.argv.includes("--smoke-test") ||
  app.commandLine.hasSwitch("smoke-test");
if (smokeMode) {
  if (smokeMarkerReady) unlinkSync(smokeMarker);
  app.disableHardwareAcceleration();
  app.setPath(
    "userData",
    path.join(app.getPath("temp"), `oscode-smoke-${process.pid}`),
  );
}
async function stopProjectProcesses() {
  const child = runningScript;
  runningScript = null;
  runningDebug = false;
  child?.kill();
  await aiService?.stop();
  await agentControlService?.stop();
  platformioService?.stop();
  await Promise.all([...terminals.keys()].map(disposeTerminal));
}

async function disposeTerminal(id: string) {
  const pending = terminalDisposals.get(id);
  if (pending) {
    await pending;
    return;
  }
  const terminal = terminals.get(id);
  if (!terminal) return;
  const disposal = new Promise<void>((resolve) => {
    let forceTimeout: ReturnType<typeof setTimeout> | undefined;
    let giveUpTimeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (forceTimeout) clearTimeout(forceTimeout);
      if (giveUpTimeout) clearTimeout(giveUpTimeout);
      exited.dispose();
      resolve();
    };
    const exited = terminal.onExit(finish);
    try {
      terminal.write("exit\r");
    } catch {
      /* fall through to the forced shutdown */
    }
    forceTimeout = setTimeout(() => {
      try {
        terminal.kill();
      } catch {
        finish();
        return;
      }
      giveUpTimeout = setTimeout(finish, 500);
    }, 2_500);
  });
  terminalDisposals.set(id, disposal);
  try {
    await disposal;
    if (terminals.get(id) === terminal) terminals.delete(id);
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    terminalDisposals.delete(id);
  }
}

async function confirmDiscardChanges(detail: string) {
  const options = {
    type: "warning" as const,
    title: "Unsaved changes",
    message: "Discard unsaved changes?",
    detail,
    buttons: ["Keep editing", "Discard changes"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

const ignored = new Set([
  ".git",
  ".oscode",
  ".venv",
  "venv",
  "node_modules",
  "dist",
  "release",
  ".next",
  "__pycache__",
]);
async function tree(dir: string): Promise<TreeEntry[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => !ignored.has(e.name) && !e.isSymbolicLink())
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .map((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory()
        ? { name: e.name, path: full, kind: "directory" as const }
        : { name: e.name, path: full, kind: "file" as const };
    });
}

async function searchProject(queryValue: unknown) {
  if (!projectRoot) throw new Error("Open a project first");
  if (typeof queryValue !== "string") throw new Error("Search text is invalid");
  const query = queryValue
    .replace(/[\r\n\0]/g, " ")
    .trim()
    .slice(0, 200);
  if (!query) return [];
  const needle = query.toLocaleLowerCase();
  const results: Array<{
    path: string;
    relativePath: string;
    line: number;
    preview: string;
  }> = [];
  let visited = 0;
  const visit = async (directory: string) => {
    if (results.length >= 250 || visited >= 2_500) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= 250 || visited >= 2_500) break;
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      visited += 1;
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || stat.size > 2_000_000) continue;
      let content = "";
      try {
        content = decodeTextFile(await fs.readFile(full));
      } catch {
        continue;
      }
      const lines = content.split(/\r?\n/);
      for (
        let index = 0;
        index < lines.length && results.length < 250;
        index += 1
      ) {
        if (!lines[index].toLocaleLowerCase().includes(needle)) continue;
        results.push({
          path: full,
          relativePath: path.relative(projectRoot, full).replace(/\\/g, "/"),
          line: index + 1,
          preview: lines[index].trim().slice(0, 240),
        });
      }
    }
  };
  await visit(projectRoot);
  return results;
}
function withinRoot(target: string) {
  const relative = path.relative(projectRoot, target);
  return (
    projectRoot && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}
async function safeProjectPath(target: string) {
  if (!projectRoot) throw new Error("Open a project first");
  const [root, resolved] = await Promise.all([
    fs.realpath(projectRoot),
    fs.realpath(target),
  ]);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Path is outside the project");
  return resolved;
}
async function projectPrivateDirectory(parts: string[], create: boolean) {
  if (!projectRoot) throw new Error("Open a project first");
  const root = await fs.realpath(projectRoot);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const item = await fs.lstat(current).catch(() => null);
    if (!item) {
      if (!create) return "";
      await fs.mkdir(current);
    } else if (!item.isDirectory() || item.isSymbolicLink()) {
      throw new Error(`Project storage “${part}” must be a regular folder`);
    }
    const resolved = await fs.realpath(current);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Project storage is outside the project");
    current = resolved;
  }
  return current;
}
function projectItemName(input: string) {
  const name = input.trim();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(name) ||
    /[. ]$/.test(name)
  )
    throw new Error("Use a simple cross-platform file or folder name");
  return name;
}
let resolvedGitExecutable = "";
async function gitExecutable() {
  if (resolvedGitExecutable) return resolvedGitExecutable;
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.resourcesPath, "git", "cmd", "git.exe"),
          process.env.LOCALAPPDATA
            ? path.join(
                process.env.LOCALAPPDATA,
                "Programs",
                "Git",
                "cmd",
                "git.exe",
              )
            : "",
          process.env.ProgramFiles
            ? path.join(process.env.ProgramFiles, "Git", "cmd", "git.exe")
            : "",
        ].filter(Boolean)
      : process.platform === "darwin"
        ? [
            "/opt/homebrew/bin/git",
            "/usr/local/bin/git",
            "/Applications/Xcode.app/Contents/Developer/usr/bin/git",
            "/usr/bin/git",
            "git",
          ]
        : ["/usr/bin/git", "/usr/local/bin/git", "git"];
  for (const candidate of candidates) {
    if (candidate === "git") return (resolvedGitExecutable = candidate);
    try {
      await fs.access(candidate);
      return (resolvedGitExecutable = candidate);
    } catch {
      /* try the next known local Git location */
    }
  }
  return (resolvedGitExecutable = "git");
}
async function executeGit(args: string[], cwd: string) {
  try {
    return await exec(await gitExecutable(), args, {
      cwd,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/ENOENT|not recognized|not found/i.test(message))
      throw new Error(
        "Git is unavailable. Reinstall osCode or install Git for this operating system.",
      );
    throw error;
  }
}
async function git(args: string[]) {
  return (await executeGit(args, projectRoot)).stdout.trim();
}
async function gitRaw(args: string[]) {
  return (await executeGit(args, projectRoot)).stdout;
}
async function ensureLocalGitIdentity() {
  const [name, email] = await Promise.all([
    git(["config", "--get", "user.name"]).catch(() => ""),
    git(["config", "--get", "user.email"]).catch(() => ""),
  ]);
  if (name && email) return;
  const account =
    (os.userInfo().username || "Local user")
      .replace(/[\r\n\0<>]/g, "")
      .trim()
      .slice(0, 80) || "Local user";
  const slug =
    account
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "local-user";
  if (!name) await git(["config", "--local", "user.name", account]);
  if (!email)
    await git([
      "config",
      "--local",
      "user.email",
      `${slug}@users.noreply.local`,
    ]);
}
function emptyGitState(): GitState {
  return {
    initialized: false,
    branch: "",
    branches: [],
    remote: "",
    ahead: 0,
    behind: 0,
    userName: "",
    userEmail: "",
    submodules: [],
    stashes: [],
    tags: [],
    files: [],
    commits: [],
  };
}
async function gitState(): Promise<GitState> {
  try {
    await git(["rev-parse", "--is-inside-work-tree"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not a git repository/i.test(message)) return emptyGitState();
    throw error;
  }
  let repositoryDetails: string[];
  try {
    repositoryDetails = await Promise.all([
      git(["branch", "--show-current"]).catch(() => ""),
      git(["branch", "--format=%(refname:short)"]).catch(() => ""),
      git(["remote", "get-url", "origin"]).catch(() => ""),
      gitRaw(["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).catch(
        () => "",
      ),
      git([
        "config",
        "-f",
        ".gitmodules",
        "--get-regexp",
        "^submodule\..*\.(path|url)$",
      ]).catch(() => ""),
      git(["config", "--local", "--get", "user.name"]).catch(() => ""),
      git(["config", "--local", "--get", "user.email"]).catch(() => ""),
      git(["stash", "list", "--format=%gd%x09%s"]).catch(() => ""),
      git(["tag", "--list"]).catch(() => ""),
      git(["log", "-30", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s"]).catch(
        () => "",
      ),
      git(["rev-list", "@{upstream}..HEAD"]).catch(() => ""),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /not a git repository|cannot change to|ENOENT|no such file/i.test(message)
    )
      return emptyGitState();
    throw error;
  }
  const [
    branch,
    branchesRaw,
    remote,
    raw,
    tracking,
    subRaw,
    userName,
    userEmail,
    stashRaw,
    tagsRaw,
    commitsRaw,
    unpushedRaw,
  ] = repositoryDetails;
  const { behind, ahead } = parseTracking(tracking);
  const submoduleMap = new Map<string, { path: string; url: string }>();
  for (const line of subRaw.split("\n").filter(Boolean)) {
    const separator = line.indexOf(" ");
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    const match = key.match(/^submodule\.(.+)\.(path|url)$/);
    if (!match) continue;
    const item = submoduleMap.get(match[1]) || { path: "", url: "" };
    item[match[2] as "path" | "url"] = value;
    submoduleMap.set(match[1], item);
  }
  const submodules = [...submoduleMap.values()].filter((item) => item.path);
  const branches = branchesRaw.split("\n").filter(Boolean);
  if (branch && !branches.includes(branch)) branches.unshift(branch);
  const unpushed = new Set(unpushedRaw.split("\n").filter(Boolean));
  const commits: GitCommit[] = commitsRaw
    .split("\n")
    .filter(Boolean)
    .map((line): GitCommit => {
      const [id, shortId, author, date, ...subject] = line.split("\x1f");
      return {
        id,
        shortId,
        author,
        date,
        subject: subject.join("\x1f"),
        state: !remote ? "local" : unpushed.has(id) ? "unpushed" : "pushed",
      };
    })
    .filter((item) => item.id && item.shortId);
  return {
    initialized: true,
    branch: branch || "detached",
    branches,
    remote,
    ahead,
    behind,
    userName,
    userEmail,
    submodules,
    stashes: stashRaw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [ref, ...rest] = line.split("\t");
        return { ref, message: rest.join("\t") || ref };
      }),
    tags: tagsRaw.split("\n").filter(Boolean),
    files: parseGitStatus(raw),
    commits,
  };
}
type PythonRuntimeRecord = {
  version: string;
  path: string;
  installed: boolean;
};
const pythonRegistryPath = () =>
  path.join(app.getPath("userData"), "python-runtimes.json");
const pythonSelectionsPath = () =>
  path.join(app.getPath("userData"), "python-selections.json");
const preferencesPath = () =>
  path.join(app.getPath("userData"), "preferences.json");
async function readPreferences() {
  try {
    return validPreferences(
      JSON.parse(await fs.readFile(preferencesPath(), "utf8")),
    );
  } catch {
    return defaultPreferences;
  }
}
async function writePreferences(value: unknown) {
  const preferences = validPreferences(value);
  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(
    preferencesPath(),
    JSON.stringify(preferences, null, 2),
    "utf8",
  );
  return preferences;
}
async function inspectPython(requested: string) {
  if (!path.isAbsolute(requested))
    throw new Error("Select an absolute Python interpreter path");
  const executable = path.resolve(requested);
  if (!(await fs.stat(executable)).isFile())
    throw new Error("The Python interpreter is not a file");
  const marker = "__OSCODE_PYTHON__";
  const { stdout } = await exec(
    executable,
    [
      "-c",
      `import json,sys;print(${JSON.stringify(marker)}+json.dumps({"version":list(sys.version_info[:3]),"executable":sys.executable}))`,
    ],
    { timeout: 10_000 },
  );
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(marker));
  if (!line) throw new Error("The selected file is not a Python 3 interpreter");
  const details = JSON.parse(line.slice(marker.length)) as {
    version?: unknown;
    executable?: unknown;
  };
  if (
    !Array.isArray(details.version) ||
    details.version.length < 3 ||
    details.version[0] !== 3 ||
    details.version.some((part) => !Number.isInteger(part))
  )
    throw new Error(
      "The selected file is not a supported Python 3 interpreter",
    );
  const reported =
    typeof details.executable === "string" &&
    path.isAbsolute(details.executable)
      ? path.resolve(details.executable)
      : executable;
  await fs.access(reported);
  return {
    path: reported,
    fullVersion: details.version.slice(0, 3).join("."),
  };
}
async function customPythonList(): Promise<PythonRuntimeRecord[]> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(pythonRegistryPath(), "utf8"),
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid: PythonRuntimeRecord[] = [];
    for (const item of parsed) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.version !== "string" ||
        typeof item.path !== "string" ||
        !path.isAbsolute(item.path)
      )
        continue;
      try {
        const executable = await fs.realpath(item.path);
        valid.push({
          version: item.version,
          path: executable,
          installed: true,
        });
      } catch {
        /* ignore interpreters that were moved or removed */
      }
    }
    return valid;
  } catch {
    return [];
  }
}
async function saveCustomPython(runtimes: PythonRuntimeRecord[]) {
  await fs.writeFile(
    pythonRegistryPath(),
    JSON.stringify(runtimes, null, 2),
    "utf8",
  );
}
const managedPythonRoot = () => path.join(app.getPath("userData"), "python");
function bundledToolPath(tool: "uv" | "python") {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, tool)
    : path.join(app.getAppPath(), "vendor", tool);
  return path.join(root, `${process.platform}-${process.arch}`);
}
async function executableFiles(root: string): Promise<string[]> {
  const results: string[] = [];
  const visit = async (directory: string, depth: number) => {
    if (depth > 6) return;
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate, depth + 1);
      else if (
        entry.isFile() &&
        (process.platform === "win32"
          ? /^python(?:3(?:\.\d+)?)?\.exe$/i.test(entry.name)
          : /^python3(?:\.\d+)?$/.test(entry.name))
      )
        results.push(candidate);
    }
  };
  await visit(root, 0);
  return results;
}
async function containedPythonList() {
  const results = new Map<string, PythonRuntimeRecord>();
  for (const root of [bundledToolPath("python"), managedPythonRoot()]) {
    for (const candidate of await executableFiles(root)) {
      try {
        const inspected = await inspectPython(candidate);
        const version = inspected.fullVersion.split(".").slice(0, 2).join(".");
        if (!results.has(version))
          results.set(version, {
            version,
            path: inspected.path,
            installed: true,
          });
      } catch {
        /* ignore helper executables and incomplete downloads */
      }
    }
  }
  return results;
}
async function uvExecutable() {
  const name = process.platform === "win32" ? "uv.exe" : "uv";
  const find = async (directory: string, depth = 0): Promise<string> => {
    if (depth > 3) return "";
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return "";
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === name) return candidate;
      if (entry.isDirectory()) {
        const nested = await find(candidate, depth + 1);
        if (nested) return nested;
      }
    }
    return "";
  };
  return (await find(bundledToolPath("uv"))) || "uv";
}
async function readPythonSelections() {
  try {
    return validPythonSelections(
      JSON.parse(await fs.readFile(pythonSelectionsPath(), "utf8")),
    );
  } catch {
    return {};
  }
}
async function savePythonSelections(selections: Record<string, string>) {
  await fs.writeFile(
    pythonSelectionsPath(),
    JSON.stringify(selections, null, 2),
    "utf8",
  );
}
function createWindow(show = true) {
  allowWindowClose = false;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: process.platform !== "darwin",
    show,
    backgroundColor: "#111719",
    icon: app.isPackaged
      ? undefined
      : path.join(app.getAppPath(), "build", "icon.png"),
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWindow.webContents.session.setSpellCheckerLanguages(["en-US"]);
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(app.getAppPath(), "dist/index.html"));
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape" && agentControlService?.isActive()) {
      event.preventDefault();
      void agentControlService.stop();
    }
  });
  mainWindow.webContents.on("context-menu", (_event, params) => {
    if (!spellcheckEnabled || !params.misspelledWord) return;
    const word = params.misspelledWord;
    const suggestions = params.dictionarySuggestions.slice(0, 8);
    const template: MenuItemConstructorOptions[] = suggestions.map(
      (suggestion) => ({
        label: suggestion,
        click: () => mainWindow?.webContents.replaceMisspelling(suggestion),
      }),
    );
    if (!suggestions.length)
      template.push({ label: "No suggestions", enabled: false });
    template.push(
      { type: "separator" },
      {
        label: "Replace all",
        enabled: suggestions.length > 0,
        submenu: suggestions.map((suggestion) => ({
          label: suggestion,
          click: () =>
            sendToRenderer("spellcheck:replace-all", word, suggestion),
        })),
      },
      {
        label: "Add to dictionary",
        click: () =>
          mainWindow?.webContents.session.addWordToSpellCheckerDictionary(word),
      },
    );
    if (mainWindow)
      Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });
  if (process.env.OSCODE_DEBUG_RENDERER === "1") {
    mainWindow.webContents.on("console-message", (_event, level, message) =>
      console.error(`[renderer:${level}] ${message}`),
    );
    mainWindow.webContents.on("did-fail-load", (_event, code, description) =>
      console.error(`[renderer-load:${code}] ${description}`),
    );
  }
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  const window = mainWindow;
  window.on("close", (event) => {
    if (allowWindowClose || !rendererHasUnsavedChanges) return;
    event.preventDefault();
    if (closeConfirmationOpen) return;
    closeConfirmationOpen = true;
    void confirmDiscardChanges(
      "Closing osCode now will discard changes that have not been saved.",
    ).then((discard) => {
      closeConfirmationOpen = false;
      if (!discard || window.isDestroyed()) return;
      rendererHasUnsavedChanges = false;
      allowWindowClose = true;
      window.close();
    });
  });
}
async function runSmokeTest(window: BrowserWindow) {
  const timeout = setTimeout(() => {
    console.error("osCode smoke failed: renderer startup timed out");
    app.exit(1);
  }, 120_000);
  const smokeProject = path.join(app.getPath("userData"), "smoke-project");
  const smokeRemote = path.join(app.getPath("userData"), "smoke-remote.git");
  const smokeModuleSource = path.join(
    app.getPath("userData"),
    "smoke-module-source",
  );
  try {
    await fs.mkdir(smokeProject, { recursive: true });
    await fs.writeFile(
      path.join(smokeProject, "smoke.py"),
      "message = 'smoke_ready'\nprint(message)\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(smokeProject, "README.md"),
      "# Smoke preview\n\n```mermaid\nflowchart LR\n  Edit --> Preview\n```\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(smokeProject, "SmokeView.swift"),
      'import SwiftUI\n\nstruct SmokeView: View {\n  var body: some View { Text("SwiftUI ready") }\n}\n',
      "utf8",
    );
    await fs.writeFile(
      path.join(smokeProject, "agent-preview.html"),
      "<!doctype html><html><body><label>Test value<input placeholder=\"Test value\"></label><button onclick=\"document.querySelector('output').textContent='Browser test passed'\">Run test</button><output></output></body></html>",
      "utf8",
    );
    const smokeGit = (args: string[]) => executeGit(args, smokeProject);
    try {
      await smokeGit(["init", "-b", "main"]);
    } catch {
      await smokeGit(["init"]);
      await smokeGit(["branch", "-M", "main"]);
    }
    await smokeGit(["config", "user.name", "osCode Smoke"]);
    await smokeGit(["config", "user.email", "smoke@oscode.local"]);
    await smokeGit(["add", "--", "smoke.py", "README.md", "SmokeView.swift"]);
    await smokeGit(["commit", "-m", "Initial smoke project"]);
    const moduleRoot = path.join(smokeProject, "vendor", "sample-module");
    await fs.mkdir(smokeModuleSource, { recursive: true });
    await fs.writeFile(
      path.join(smokeModuleSource, "module.py"),
      "value = 'absorbed'\n",
      "utf8",
    );
    const moduleGit = (args: string[]) => executeGit(args, smokeModuleSource);
    await moduleGit(["init"]);
    await moduleGit(["config", "user.name", "osCode Smoke"]);
    await moduleGit(["config", "user.email", "smoke@oscode.local"]);
    await moduleGit(["add", "--", "module.py"]);
    await moduleGit(["commit", "-m", "Create smoke module"]);
    const moduleCommit = (await moduleGit(["rev-parse", "HEAD"])).stdout.trim();
    await smokeGit(["fetch", smokeModuleSource, "HEAD"]);
    await fs.mkdir(path.dirname(moduleRoot), { recursive: true });
    await executeGit(["clone", smokeModuleSource, moduleRoot], smokeProject);
    const managedModuleGit = path.join(
      smokeProject,
      ".git",
      "modules",
      "vendor",
      "sample-module",
    );
    await fs.mkdir(path.dirname(managedModuleGit), { recursive: true });
    await fs.rename(path.join(moduleRoot, ".git"), managedModuleGit);
    await fs.writeFile(
      path.join(moduleRoot, ".git"),
      "gitdir: ../../.git/modules/vendor/sample-module\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(smokeProject, ".gitmodules"),
      '[submodule "vendor/sample-module"]\n\tpath = vendor/sample-module\n\turl = https://example.invalid/sample-module.git\n',
      "utf8",
    );
    await smokeGit(["add", "--", ".gitmodules"]);
    await smokeGit([
      "update-index",
      "--add",
      "--cacheinfo",
      "160000",
      moduleCommit,
      "vendor/sample-module",
    ]);
    await smokeGit(["commit", "-m", "Add smoke submodule"]);
    await executeGit(["init", "--bare", smokeRemote], smokeProject);
    const smokeRemoteUrl = pathToFileURL(smokeRemote).toString();
    const contents = window.webContents;
    if (contents.isLoadingMainFrame()) {
      await new Promise<void>((resolve, reject) => {
        const loaded = () => {
          contents.removeListener("did-fail-load", failed);
          resolve();
        };
        const failed = (
          _event: Electron.Event,
          code: number,
          description: string,
        ) => {
          contents.removeListener("did-finish-load", loaded);
          reject(new Error(`renderer load failed (${code}): ${description}`));
        };
        contents.once("did-finish-load", loaded);
        contents.once("did-fail-load", failed);
      });
    }
    const result = (await contents.executeJavaScript(`(async () => {
      const waitFor = async (check, label) => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          const value = check();
          if (value) return value;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error('Timed out waiting for ' + label);
      };
      const bridgeReady =
        typeof window.oscode?.platform === 'string' &&
        typeof window.oscode?.confirmDiscardChanges === 'function' &&
        typeof window.oscode?.setDirtyState === 'function' &&
        typeof window.oscode?.openProject === 'function' &&
        typeof window.oscode?.createTerminal === 'function' &&
        typeof window.oscode?.gitRun === 'function' &&
        typeof window.oscode?.deleteRepository === 'function' &&
        typeof window.oscode?.listPython === 'function' &&
        typeof window.oscode?.getProjectPython === 'function' &&
        typeof window.oscode?.setProjectPython === 'function' &&
        typeof window.oscode?.loadPreferences === 'function' &&
        typeof window.oscode?.savePreferences === 'function' &&
        typeof window.oscode?.appUpdateStatus === 'function' &&
        typeof window.oscode?.setAppAutoUpdate === 'function' &&
        typeof window.oscode?.checkForAppUpdate === 'function' &&
        typeof window.oscode?.listAiModels === 'function' &&
        typeof window.oscode?.removeAiModel === 'function' &&
        typeof window.oscode?.exportDiagram === 'function' &&
        typeof window.oscode?.platformioState === 'function' &&
        typeof window.oscode?.installPlatformio === 'function' &&
        typeof window.oscode?.runPlatformio === 'function' &&
        typeof window.oscode?.stopPlatformio === 'function' &&
        typeof window.oscode?.aiChat === 'function' &&
        typeof window.oscode?.resolveAiEdits === 'function' &&
        typeof window.oscode?.stopAi === 'function' &&
        typeof window.oscode?.stopAgentControl === 'function' &&
        typeof window.oscode?.agentBrowserSnapshot === 'function' &&
        typeof window.oscode?.onAgentActivity === 'function' &&
        typeof window.oscode?.closeProject === 'function';
      const keepUpdatesOff = await waitFor(
        () => [...document.querySelectorAll('.notification-choice button')].find(
          item => item.textContent.trim() === 'Keep off'
        ),
        'automatic update opt-in prompt'
      );
      keepUpdatesOff.click();
      const autoUpdatePromptReady = await waitFor(
        () => !document.querySelector('.notification-row.update-prompt'),
        'remember automatic update choice'
      );
      const aiHiddenAtBoot = !document.querySelector('.ai-panel');
      const pythonControlsBeforeFile = Boolean(
        document.querySelector('[aria-label="Python interpreter"]')
      );
      let file = [...document.querySelectorAll('.tree-row')].find(
        item => item.textContent.trim() === 'smoke.py'
      );
      if (!file) {
        const startupControl = await waitFor(
          () => document.querySelector('[aria-label="Project folder path"]') ||
            [...document.querySelectorAll('.tree-row')].find(
              item => item.textContent.trim() === 'smoke.py'
            ),
          'project startup'
        );
        if (startupControl.matches?.('[aria-label="Project folder path"]')) {
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
          ).set;
          setter.call(startupControl, ${JSON.stringify(smokeProject)});
          startupControl.dispatchEvent(new Event('input', { bubbles: true }));
          const open = [...document.querySelectorAll('button')].find(
            item => item.textContent.trim() === 'Open path'
          );
          open.click();
        }
        file = await waitFor(
          () => [...document.querySelectorAll('.tree-row')].find(
            item => item.textContent.trim() === 'smoke.py'
          ),
          'smoke project file'
        );
      }
      file.click();
      const editor = await waitFor(
        () => document.querySelector('.local-editor-host[data-oscode-ready="true"]'),
        'local Monaco editor'
      );
      const swiftFile = [...document.querySelectorAll('.tree-row')].find(
        item => item.textContent.trim() === 'SmokeView.swift'
      );
      swiftFile.click();
      const swiftReady = await waitFor(
        () => editor.dataset.oscodeLanguage === 'swift',
        'Swift language detection'
      );
      const readme = [...document.querySelectorAll('.tree-row')].find(
        item => item.textContent.trim() === 'README.md'
      );
      readme.click();
      const proseWrapDefault = await waitFor(
        () => editor.dataset.oscodeWordWrap === 'on',
        'default prose wrapping'
      );
      const markdownPreview = await waitFor(
        () => document.querySelector('.markdown-preview'),
        'Markdown preview'
      );
      const mermaidDiagram = await waitFor(
        () => markdownPreview.querySelector('.markdown-diagram-canvas svg'),
        'Mermaid diagram'
      );
      const markdownReady =
        Boolean(mermaidDiagram) &&
        [...markdownPreview.querySelectorAll('button')].some(
          button => button.textContent.trim() === 'Copy SVG'
        );
      file.click();
      await waitFor(
        () => document.querySelector('[aria-label="Python interpreter"]'),
        'Python controls after Markdown preview'
      );
      const gitBeforeAbsorb = await window.oscode.gitState();
      if (!gitBeforeAbsorb.submodules.some(
        item => item.path === 'vendor/sample-module'
      )) {
        throw new Error(
          'Smoke submodule was not detected: ' + JSON.stringify(gitBeforeAbsorb)
        );
      }
      const gitAfterAbsorb = await window.oscode.absorbSubmodule(
        'vendor/sample-module'
      );
      await window.oscode.gitRun('addAll');
      await window.oscode.gitRun('commit', 'Absorb smoke submodule');
      await window.oscode.gitRun('branchCreate', 'feature/smoke-controls');
      await window.oscode.createProjectItem(
        ${JSON.stringify(smokeProject)},
        'branch-smoke.txt',
        'file'
      );
      await window.oscode.writeFile(
        ${JSON.stringify(path.join(smokeProject, "branch-smoke.txt"))},
        'branch controls ready\\n'
      );
      await window.oscode.gitRun('addAll');
      await window.oscode.gitRun('commit', 'Exercise branch controls');
      await window.oscode.gitRun('branchSwitch', 'main');
      await window.oscode.gitRun('merge', 'feature/smoke-controls');
      const branchState = await window.oscode.gitRun(
        'branchDelete',
        'feature/smoke-controls'
      );
      const gitWithRemote = await window.oscode.gitRun(
        'remote',
        ${JSON.stringify(smokeRemoteUrl)}
      );
      await window.oscode.gitRun('push');
      await window.oscode.gitRun('pull');
      const gitAfterSync = await window.oscode.gitState();
      const runtimeSelect = await waitFor(
        () => document.querySelector('[aria-label="Python interpreter"]'),
        'Python controls'
      );
      const projectSelectionReady =
        typeof (await window.oscode.getProjectPython()) === 'string';
      const downloadOptions = [...runtimeSelect.options].filter(option =>
        option.value.startsWith('download:')
      );
      const containedBaseRuntimes = ['3.10', '3.11', '3.12'].every(version =>
        [...runtimeSelect.options].some(option =>
          option.textContent.includes(version) &&
          !option.value.startsWith('download:')
        )
      );
      const advancedButton = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'Advanced'
      );
      advancedButton.click();
      const advancedDock = await waitFor(
        () => document.querySelector('.advanced-dock'),
        'advanced mode'
      );
      advancedButton.click();
      const settingsButton = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'Settings'
      );
      settingsButton.click();
      const settingsDock = await waitFor(
        () => document.querySelector('.settings-dock'),
        'settings panel'
      );
      const themeLabels = [...settingsDock.querySelectorAll('.theme-choice button')]
        .map(button => button.textContent.trim());
      const themeChoicesReady =
        themeLabels.length === 3 &&
        ['Grey + blue', 'Blue dark', 'Blue light'].every(label =>
          themeLabels.includes(label)
        );
      const proseWrapToggle = [...settingsDock.querySelectorAll('label')].find(
        item => item.querySelector('span')?.textContent.trim() === 'Wrap prose files'
      )?.querySelector('input');
      const proseWrapSettingReady =
        Boolean(proseWrapDefault) && Boolean(proseWrapToggle?.checked);
      proseWrapToggle.click();
      await waitFor(() => !proseWrapToggle.checked, 'disable prose wrapping');
      proseWrapToggle.click();
      await waitFor(() => proseWrapToggle.checked, 'enable prose wrapping');
      const chatButton = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'Chat'
      );
      chatButton.click();
      const aiPanel = await waitFor(
        () => document.querySelector('.ai-panel'),
        'AI panel after Chat is enabled'
      );
      const aiCapabilitiesDefaultOff = [
        'File access: off',
        'Web access: off',
        'Dedicated agent browser: off',
        'Computer Control: off'
      ].every(label => aiPanel.querySelector('[aria-label="' + label + '"]'));
      const layoutSelect = [...settingsDock.querySelectorAll('label')].find(
        item => item.querySelector('span')?.textContent.trim() === 'Project and AI layout'
      )?.querySelector('select');
      layoutSelect.value = 'right';
      layoutSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const aiSwapReady = await waitFor(
        () => document.querySelector('.workspace.ai-left.sidebar-right'),
        'AI column swap'
      );
      layoutSelect.value = 'left';
      layoutSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const lightButton = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'Blue light'
      );
      lightButton.click();
      const lightThemeReady = await waitFor(
        () => document.querySelector('.app.blue-light'),
        'light theme'
      );
      const platformioButton = [...document.querySelectorAll('button')].find(
        item => item.textContent.trim() === 'PlatformIO'
      );
      platformioButton.click();
      const platformioDock = await waitFor(
        () => document.querySelector('.platformio-dock'),
        'PlatformIO panel'
      );
      const platformioState = await window.oscode.platformioState();
      const platformioReady =
        platformioState.telemetry === false &&
        platformioDock.innerText.includes('Install Core');
      platformioDock.querySelector('[aria-label="Close PlatformIO"]').click();
      settingsButton.click();
      await waitFor(
        () => !document.querySelector('.settings-dock'),
        'settings panel close'
      );
      const aiWorkspaceButton = document.querySelector(
        '[aria-label="Chats and tasks"]'
      );
      const aiHistoryButton = document.querySelector('[aria-label="AI changes"]');
      const aiPermissionButton = document.querySelector(
        '[aria-label="Permissions"]'
      );
      const aiSettingsButton = document.querySelector('[aria-label="AI settings"]');
      aiWorkspaceButton.click();
      await waitFor(
        () => document.querySelector('.ai-agent-popover'),
        'chat workspace popup'
      );
      aiHistoryButton.click();
      await waitFor(
        () =>
          document.querySelector('.ai-history-popover') &&
          !document.querySelector('.ai-agent-popover'),
        'exclusive AI history popup'
      );
      aiPermissionButton.click();
      await waitFor(
        () =>
          document.querySelector('.ai-permission-popover') &&
          !document.querySelector('.ai-history-popover'),
        'exclusive AI permissions popup'
      );
      aiSettingsButton.click();
      const aiSettings = await waitFor(
        () => {
          const manager = document.querySelector('.ai-model-manager');
          return manager && !document.querySelector('.ai-permission-popover')
            ? manager
            : null;
        },
        'exclusive AI settings popup'
      );
      const contextSelect = [...aiSettings.querySelectorAll('label')].find(
        item => item.querySelector('span')?.textContent.trim() === 'Context'
      )?.querySelector('select');
      const aiContextReady =
        Number(contextSelect?.value || 0) >= 8192 &&
        [...contextSelect.options].some(option => option.value === '262144');
      const aiModelSelected = await waitFor(
        () => document.querySelector('[data-ai-selected-model]')?.textContent.trim(),
        'automatic local model selection'
      );
      aiSettingsButton.click();
      const aiPopupsExclusive = await waitFor(
        () =>
          !document.querySelector(
            '.ai-agent-popover, .ai-history-popover, .ai-permission-popover, .ai-model-manager'
          ),
        'AI popup close'
      );
      const terminalToggle = document.querySelector('.terminal-toggle');
      terminalToggle.click();
      const terminalPanel = await waitFor(
        () => document.querySelector('.terminal-panel'),
        'terminal panel'
      );
      const terminalPanelHeight = terminalPanel.getBoundingClientRect().height;
      terminalToggle.click();
      await waitFor(
        () => !document.querySelector('.terminal-panel'),
        'terminal panel close'
      );
      await new Promise(resolve => setTimeout(resolve, 1200));
      const terminalId = 'smoke-' + Date.now();
      let terminalOutput = '';
      const stopListening = window.oscode.onTerminalData((id, data) => {
        if (id === terminalId) terminalOutput += data;
      });
      try {
        await window.oscode.createTerminal(terminalId);
        const command = window.oscode.platform === 'win32'
          ? 'Write-Output OSCODE_TERMINAL_READY\\r'
          : "printf 'OSCODE_TERMINAL_READY\\\\n'\\r";
        window.oscode.terminalWrite(terminalId, command);
        await waitFor(
          () => terminalOutput.includes('OSCODE_TERMINAL_READY'),
          'native terminal command'
        );
        window.oscode.terminalWrite(terminalId, 'exit\\r');
        await waitFor(
          () => terminalOutput.includes('[process exited'),
          'native terminal exit'
        );
      } finally {
        await window.oscode.terminalDispose(terminalId);
        stopListening();
      }
      return {
        title: document.title,
        rootReady: Boolean(document.querySelector('#root')?.children.length),
        brandReady: document.body.innerText.includes('osCode'),
        bridgeReady,
        autoUpdatePromptReady: Boolean(autoUpdatePromptReady),
        pythonControlsBeforeFile,
        projectReady: document.body.innerText.includes('smoke-project'),
        sidebarWidth: document.querySelector('.sidebar')?.getBoundingClientRect().width || 0,
        editorReady: Boolean(editor),
        editorModelLength: Number(editor.dataset.oscodeModelLength || 0),
        markdownReady,
        swiftReady: Boolean(swiftReady),
        proseWrapSettingReady,
        pythonControlsReady: Boolean(runtimeSelect),
        projectSelectionReady,
        containedBaseRuntimes,
        directRuntimeDownloads: downloadOptions.length >= 2 && downloadOptions.every(
          option => !option.disabled
        ),
        gitSubmoduleDetected: gitBeforeAbsorb.submodules.some(
          item =>
            item.path === 'vendor/sample-module' &&
            item.url === 'https://example.invalid/sample-module.git'
        ),
        gitSubmoduleAbsorbed:
          gitAfterAbsorb.submodules.length === 0 &&
          gitAfterAbsorb.files.some(file =>
            file.path === 'vendor/sample-module/module.py'
          ),
        gitLocalIdentityReady:
          Boolean(gitAfterSync.userName) && Boolean(gitAfterSync.userEmail),
        gitBranchesReady:
          branchState.branch === 'main' &&
          !branchState.branches.includes('feature/smoke-controls'),
        gitRemoteReady: gitWithRemote.remote === ${JSON.stringify(smokeRemoteUrl)},
        gitSyncReady:
          gitAfterSync.files.length === 0 &&
          gitAfterSync.ahead === 0 &&
          gitAfterSync.behind === 0,
        advancedReady: Boolean(advancedDock),
        settingsReady: Boolean(settingsDock),
        themeChoicesReady,
        platformioReady,
        aiPanelReady:
          Boolean(aiPanel) &&
          aiPanel.getBoundingClientRect().width >= 280 &&
          Boolean(aiSwapReady) &&
          (await window.oscode.listAiModels()).length >= 0,
        aiHiddenAtBoot,
        aiCapabilitiesDefaultOff,
        aiPopupsExclusive: Boolean(aiPopupsExclusive),
        aiContextReady: Boolean(aiContextReady),
        aiModelSelected: Boolean(aiModelSelected),
        lightThemeReady: Boolean(lightThemeReady),
        terminalPanelHeight,
        terminalReady: terminalOutput.includes('OSCODE_TERMINAL_READY')
      };
    })().catch(error => ({
      smokeError: String(error?.stack || error)
    }))`)) as Record<string, unknown>;
    sendToRenderer("agent:activity", {
      kind: "computer",
      label: "Computer Control · test app · accessibility · Esc to stop",
      active: true,
      network: false,
      target: "test app",
      mode: "background",
    });
    await new Promise((resolve) => setTimeout(resolve, 180));
    result.globalSearchWithActivityReady =
      await contents.executeJavaScript(`(() => {
      const search = document.querySelector('.global-search')?.getBoundingClientRect();
      const status = document.querySelector('.top-status')?.getBoundingClientRect();
      const bar = document.querySelector('.topbar')?.getBoundingClientRect();
      return Boolean(
        search && status && bar &&
        search.width >= 150 &&
        status.width >= 42 &&
        search.right <= status.left + 1 &&
        search.left >= bar.left &&
        status.right <= bar.right
      );
    })()`);
    sendToRenderer("agent:activity", {
      kind: "computer",
      label: "Computer Control stopped",
      active: false,
      network: false,
    });
    try {
      await agentControlService.openBrowser("agent-preview.html");
      sendToRenderer("agent:activity", {
        kind: "browser",
        label: "Browser · agent-preview.html",
        active: true,
        network: false,
        target: "agent-preview.html",
      });
      await new Promise((resolve) => setTimeout(resolve, 180));
      result.agentBrowserViewReady =
        await contents.executeJavaScript(`(async () => {
        const deadline = Date.now() + 10000;
        const view = [...document.querySelectorAll('button')].find(
          item => item.textContent.trim() === 'View browser'
        );
        if (!view) return false;
        view.click();
        while (Date.now() < deadline) {
          const preview = document.querySelector('.agent-browser-view img');
          if (preview?.src.startsWith('data:image/png;base64,')) return true;
          await new Promise(resolve => setTimeout(resolve, 80));
        }
        return false;
      })()`);
      const browserBefore = JSON.parse(
        await agentControlService.inspectBrowser(),
      ) as { controls?: Array<{ label?: string }> };
      await agentControlService.typeBrowser("Test value", "local only");
      await agentControlService.clickBrowser("Run test");
      const browserAfter = JSON.parse(
        await agentControlService.inspectBrowser(),
      ) as { text?: string };
      const browserSnapshot = await agentControlService.browserSnapshot();
      const computerBefore = JSON.parse(
        await agentControlService.inspectComputer(),
      ) as { controls?: Array<{ label?: string }> };
      await agentControlService.clickComputer("Notifications");
      const computerAfter = JSON.parse(
        await agentControlService.inspectComputer(),
      ) as { text?: string };
      result.agentBrowserReady =
        browserBefore.controls?.some((item) => item.label === "Run test") ===
          true &&
        /Browser test passed/.test(browserAfter.text || "") &&
        browserSnapshot?.imageDataUrl.startsWith("data:image/png;base64,") ===
          true;
      result.computerControlReady =
        computerBefore.controls?.some(
          (item) => item.label === "Notifications",
        ) === true && /Notifications/.test(computerAfter.text || "");
    } catch (error) {
      result.agentControlError =
        error instanceof Error ? error.message : String(error);
    } finally {
      await agentControlService.stop();
    }
    if (result.smokeError)
      throw new Error(`renderer checks threw: ${String(result.smokeError)}`);
    if (
      result.title !== "osCode" ||
      result.rootReady !== true ||
      result.brandReady !== true ||
      result.bridgeReady !== true ||
      result.autoUpdatePromptReady !== true ||
      result.pythonControlsBeforeFile !== false ||
      result.projectReady !== true ||
      Number(result.sidebarWidth) < 200 ||
      result.editorReady !== true ||
      result.markdownReady !== true ||
      result.swiftReady !== true ||
      result.proseWrapSettingReady !== true ||
      result.pythonControlsReady !== true ||
      result.projectSelectionReady !== true ||
      result.containedBaseRuntimes !== true ||
      result.directRuntimeDownloads !== true ||
      result.gitSubmoduleDetected !== true ||
      result.gitSubmoduleAbsorbed !== true ||
      result.gitLocalIdentityReady !== true ||
      result.gitBranchesReady !== true ||
      result.gitRemoteReady !== true ||
      result.gitSyncReady !== true ||
      result.advancedReady !== true ||
      result.settingsReady !== true ||
      result.themeChoicesReady !== true ||
      result.platformioReady !== true ||
      result.aiPanelReady !== true ||
      result.aiHiddenAtBoot !== true ||
      result.aiCapabilitiesDefaultOff !== true ||
      result.agentBrowserReady !== true ||
      result.agentBrowserViewReady !== true ||
      result.computerControlReady !== true ||
      result.aiPopupsExclusive !== true ||
      result.aiContextReady !== true ||
      result.aiModelSelected !== true ||
      result.globalSearchWithActivityReady !== true ||
      result.lightThemeReady !== true ||
      Number(result.terminalPanelHeight) < 150 ||
      result.terminalReady !== true ||
      Number(result.editorModelLength) < 20
    )
      throw new Error(`renderer checks failed: ${JSON.stringify(result)}`);
    console.log(`osCode smoke passed: ${JSON.stringify(result)}`);
    await stopProjectProcesses();
    projectRoot = "";
    const cleanupOptions = {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    } as const;
    await fs.rm(smokeProject, cleanupOptions);
    await fs.rm(smokeRemote, cleanupOptions);
    await fs.rm(smokeModuleSource, cleanupOptions);
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    await stopProjectProcesses();
    projectRoot = "";
    const cleanupOptions = {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    } as const;
    await fs.rm(smokeProject, cleanupOptions).catch(() => {});
    await fs.rm(smokeRemote, cleanupOptions).catch(() => {});
    await fs.rm(smokeModuleSource, cleanupOptions).catch(() => {});
    clearTimeout(timeout);
    console.error(
      `osCode smoke failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    app.exit(1);
  }
}
function createApplicationMenu() {
  const send = (action: string) => () =>
    mainWindow?.webContents.send("menu:action", action);
  const about = async () => {
    const options = {
      type: "info" as const,
      title: "About osCode",
      message: `osCode ${app.getVersion()}`,
      detail:
        "A calm, local-first code editor. osCode includes no telemetry or analytics.",
      buttons: ["OK"],
      defaultId: 0,
      noLink: true,
    };
    if (mainWindow) await dialog.showMessageBox(mainWindow, options);
    else await dialog.showMessageBox(options);
  };
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+O",
          click: send("open-project"),
        },
        {
          label: "New File",
          accelerator: "CmdOrCtrl+N",
          click: send("new-file"),
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: send("save"),
        },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Toggle Terminal",
          accelerator: "CmdOrCtrl+`",
          click: send("toggle-terminal"),
        },
        {
          label: "Toggle Theme",
          accelerator: "CmdOrCtrl+Shift+L",
          click: send("toggle-theme"),
        },
        {
          label: "Advanced Mode",
          accelerator: "CmdOrCtrl+Shift+A",
          click: send("toggle-advanced"),
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(!app.isPackaged
          ? [
              { type: "separator" as const },
              { role: "reload" as const },
              { role: "toggleDevTools" as const },
            ]
          : []),
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : []),
      ],
    },
    ...(process.platform === "darwin"
      ? []
      : [
          {
            label: "Help",
            submenu: [{ label: "About osCode", click: about }],
          },
        ]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function registerIpc() {
  ipcMain.on("app:set-dirty", (event, dirty: unknown) => {
    if (event.sender === mainWindow?.webContents && typeof dirty === "boolean")
      rendererHasUnsavedChanges = dirty;
  });
  ipcMain.handle(
    "dialog:confirm-discard",
    async (_event, rawDetail: unknown) => {
      const detail =
        typeof rawDetail === "string" && rawDetail.length <= 300
          ? rawDetail
          : "Continuing will discard changes that have not been saved.";
      return confirmDiscardChanges(detail);
    },
  );
  ipcMain.handle("preferences:get", readPreferences);
  ipcMain.handle("platformio:state", async () => {
    const state = await platformioService.state(projectRoot);
    if (state.autoUpdate) {
      void platformioService
        .maybeAutoUpdate()
        .then(async (updated) => {
          if (updated)
            sendToRenderer(
              "platformio:state-changed",
              await platformioService.state(projectRoot),
            );
        })
        .catch((error) =>
          sendToRenderer(
            "platformio:output",
            `Automatic update could not complete: ${error instanceof Error ? error.message : String(error)}\n`,
          ),
        );
    }
    return state;
  });
  ipcMain.handle("platformio:boards", () => platformioService.boards());
  ipcMain.handle("platformio:install", async () => {
    await platformioService.install(false);
    return platformioService.state(projectRoot);
  });
  ipcMain.handle("platformio:update", async () => {
    await platformioService.install(true);
    return platformioService.state(projectRoot);
  });
  ipcMain.handle(
    "platformio:set-auto-update",
    async (_event, enabled: unknown) => {
      if (typeof enabled !== "boolean")
        throw new Error("Invalid update preference");
      await platformioService.setAutoUpdate(enabled);
      return platformioService.state(projectRoot);
    },
  );
  ipcMain.handle(
    "platformio:initialize",
    async (_event, board: unknown, framework: unknown) => {
      if (typeof board !== "string" || typeof framework !== "string")
        throw new Error("Invalid PlatformIO project settings");
      return platformioService.initialize(
        projectRoot,
        board.trim(),
        framework.trim(),
      );
    },
  );
  ipcMain.handle(
    "platformio:run",
    async (_event, action: unknown, environment: unknown) => {
      const allowed = ["build", "upload", "clean", "test", "monitor"] as const;
      if (
        !allowed.includes(action as (typeof allowed)[number]) ||
        typeof environment !== "string"
      )
        throw new Error("Invalid PlatformIO task");
      return platformioService.run(
        action as (typeof allowed)[number],
        environment.trim(),
        projectRoot,
      );
    },
  );
  ipcMain.handle("platformio:stop", async () => platformioService.stop());
  ipcMain.handle("platformio:input", async (_event, data: unknown) => {
    if (typeof data !== "string") throw new Error("Invalid PlatformIO input");
    return platformioService.write(data);
  });
  ipcMain.handle(
    "diagram:export",
    async (
      _event,
      rawAction: unknown,
      rawFormat: unknown,
      rawData: unknown,
    ) => {
      const action =
        rawAction === "copy" || rawAction === "save" ? rawAction : "";
      const format =
        rawFormat === "svg" || rawFormat === "png" ? rawFormat : "";
      if (
        !action ||
        !format ||
        typeof rawData !== "string" ||
        rawData.length > 16_000_000
      )
        throw new Error("Diagram export is invalid");
      const data =
        format === "svg"
          ? Buffer.from(rawData, "utf8")
          : Buffer.from(
              rawData.replace(/^data:image\/png;base64,/, ""),
              "base64",
            );
      if (!data.length || data.length > 12_000_000)
        throw new Error("Diagram is too large to export");
      if (action === "copy") {
        if (format === "svg") clipboard.writeText(rawData);
        else {
          const image = nativeImage.createFromBuffer(data);
          if (image.isEmpty())
            throw new Error("Diagram image could not be copied");
          clipboard.writeImage(image);
        }
        return true;
      }
      const result = await dialog.showSaveDialog({
        title: `Save diagram as ${format.toUpperCase()}`,
        defaultPath: `diagram.${format}`,
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      });
      if (result.canceled || !result.filePath) return false;
      await fs.writeFile(result.filePath, data);
      return true;
    },
  );
  ipcMain.handle("preferences:set", async (_e, value: unknown) => {
    const preferences = await writePreferences(value);
    if (appUpdateService?.isEnabled() !== preferences.autoUpdateEnabled)
      await appUpdateService?.setEnabled(preferences.autoUpdateEnabled);
    return true;
  });
  ipcMain.handle("updates:status", () => appUpdateService.getStatus());
  ipcMain.handle("updates:set-enabled", async (_event, enabled: unknown) => {
    const current = await readPreferences();
    const preferences = await writePreferences({
      ...current,
      autoUpdateEnabled: enabled === true,
      autoUpdatePromptAnswered: true,
    });
    return appUpdateService.setEnabled(preferences.autoUpdateEnabled);
  });
  ipcMain.handle("updates:check", () => appUpdateService.check());
  ipcMain.handle("ai:list-models", () => aiService.listModels());
  ipcMain.handle("ai:hardware-profile", () => aiService.hardwareProfile());
  ipcMain.handle("ai:install-cuda-support", () =>
    aiService.installCudaSupport(),
  );
  ipcMain.handle("ai:download-oscode-model", (_event, tier: unknown) =>
    aiService.downloadOsCodeModel(tier),
  );
  ipcMain.handle("ai:agent-state", () => aiService.getAgentState());
  ipcMain.handle("ai:create-chat", (_event, title: unknown) =>
    aiService.createChat(title),
  );
  ipcMain.handle(
    "ai:save-chat",
    (_event, id: unknown, messages: unknown, contextSummary: unknown) =>
      aiService.saveChat(id, messages, contextSummary),
  );
  ipcMain.handle("ai:delete-chat", (_event, id: unknown) =>
    aiService.deleteChat(id),
  );
  ipcMain.handle(
    "ai:set-goal",
    (_event, chatId: unknown, text: unknown, automatic: unknown) =>
      aiService.setGoal(chatId, text, automatic),
  );
  ipcMain.handle("ai:complete-goal", (_event, id: unknown) =>
    aiService.completeGoal(id),
  );
  ipcMain.handle("ai:remove-goal", (_event, id: unknown) =>
    aiService.removeGoal(id),
  );
  ipcMain.handle(
    "ai:add-queue",
    (_event, chatId: unknown, prompt: unknown, runAt: unknown) =>
      aiService.addQueue(chatId, prompt, runAt),
  );
  ipcMain.handle("ai:update-queue", (_event, id: unknown, status: unknown) =>
    aiService.updateQueue(id, status),
  );
  ipcMain.handle("ai:prioritize-queue", (_event, id: unknown) =>
    aiService.prioritizeQueue(id),
  );
  ipcMain.handle("ai:remove-queue", (_event, id: unknown) =>
    aiService.removeQueue(id),
  );
  ipcMain.handle(
    "ai:add-schedule",
    (
      _event,
      chatId: unknown,
      prompt: unknown,
      nextRunAt: unknown,
      cadence: unknown,
    ) => aiService.addSchedule(chatId, prompt, nextRunAt, cadence),
  );
  ipcMain.handle("ai:remove-schedule", (_event, id: unknown) =>
    aiService.removeSchedule(id),
  );
  ipcMain.handle("ai:collect-due", () => aiService.collectDueSchedules());
  ipcMain.handle(
    "ai:grant-permission",
    (_event, kind: unknown, scope: unknown, chatId: unknown, detail: unknown) =>
      aiService.grantPermission(kind, scope, chatId, detail),
  );
  ipcMain.handle("ai:revoke-permission", (_event, id: unknown) =>
    aiService.revokePermission(id),
  );
  ipcMain.handle("ai:remove-model", (_event, id: unknown) =>
    aiService.removeModel(id),
  );
  ipcMain.handle(
    "ai:update-model-context",
    (_event, id: unknown, contextLimit: unknown) =>
      aiService.updateModelContext(id, contextLimit),
  );
  ipcMain.handle(
    "ai:choose-model",
    async (_event, rawEngine: unknown, rawKind: unknown) => {
      const engine = rawEngine as AiEngine;
      if (!["llamacpp", "pytorch", "mlx"].includes(engine)) return null;
      let kind = rawKind === "folder" ? "folder" : "file";
      if (
        engine === "llamacpp" &&
        !["file", "folder"].includes(String(rawKind))
      ) {
        const choice = await dialog.showMessageBox({
          type: "question",
          title: "Add a GGUF model",
          message: "Choose a GGUF file or a folder of GGUF files.",
          detail: "Multi-file model shards are detected automatically.",
          buttons: ["Choose file", "Choose folder", "Cancel"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (choice.response === 2) return [];
        kind = choice.response === 1 ? "folder" : "file";
      }
      const chooseFolder = engine !== "llamacpp" || kind === "folder";
      const result = await dialog.showOpenDialog({
        title:
          engine === "llamacpp" && !chooseFolder
            ? "Choose a GGUF model file"
            : engine === "llamacpp"
              ? "Choose a folder containing GGUF models"
              : `Choose a local ${engine === "mlx" ? "MLX" : "PyTorch"} model folder`,
        buttonLabel: chooseFolder ? "Add folder" : "Add model",
        properties: chooseFolder
          ? ["openDirectory"]
          : ["openFile", "multiSelections"],
        filters:
          engine === "llamacpp" && !chooseFolder
            ? [{ name: "GGUF model", extensions: ["gguf"] }]
            : undefined,
      });
      if (result.canceled) return [];
      let selectedPaths = await Promise.all(
        result.filePaths.map((item) => fs.realpath(item)),
      );
      if (engine === "llamacpp" && chooseFolder) {
        const found: string[] = [];
        const visit = async (directory: string, depth: number) => {
          if (depth > 5 || found.length >= 2000) return;
          const entries = await fs.readdir(directory, { withFileTypes: true });
          for (const entry of entries) {
            if (found.length >= 2000 || entry.isSymbolicLink()) continue;
            const full = path.join(directory, entry.name);
            if (entry.isDirectory()) await visit(full, depth + 1);
            else if (
              entry.isFile() &&
              entry.name.toLowerCase().endsWith(".gguf")
            )
              found.push(await fs.realpath(full));
          }
        };
        await visit(selectedPaths[0], 0);
        selectedPaths = found;
      }
      if (engine === "llamacpp") {
        const shard = /^(.*?)-(\d{5})-of-(\d{5})\.gguf$/i;
        const grouped = new Map<string, { path: string; count: number }>();
        for (const selected of selectedPaths) {
          const match = path.basename(selected).match(shard);
          if (!match) {
            grouped.set(selected, { path: selected, count: 1 });
            continue;
          }
          const key = path.join(path.dirname(selected), match[1].toLowerCase());
          const current = grouped.get(key);
          if (!current || Number(match[2]) === 1)
            grouped.set(key, { path: selected, count: Number(match[3]) });
        }
        selectedPaths = [...grouped.values()].map((item) => item.path);
      }
      const added: AiModel[] = [];
      for (const selected of selectedPaths) {
        const shard = path
          .basename(selected)
          .match(/^(.*?)-00001-of-(\d{5})\.gguf$/i);
        added.push(
          await aiService.registerModel({
            id: `${engine}:${selected}`,
            name: shard
              ? `${shard[1]} (${Number(shard[2])} shards)`
              : path.basename(selected),
            engine,
            path: selected,
            source: "local",
          }),
        );
      }
      return added;
    },
  );
  ipcMain.handle("ai:choose-executable", async (_event, rawEngine: unknown) => {
    const engine = rawEngine as AiEngine;
    if (engine !== "llamacpp") return "";
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [{ name: "llama.cpp command line", extensions: ["exe"] }]
          : undefined,
    });
    if (result.canceled) return "";
    const selected = await fs.realpath(result.filePaths[0]);
    if (!/llama-(?:cli|app)(?:\.exe)?$/i.test(path.basename(selected)))
      throw new Error("Choose llama-cli or the unified llama app executable");
    return selected;
  });
  ipcMain.handle(
    "ai:download-model",
    (_event, engine: unknown, source: unknown) =>
      aiService.downloadModel(engine, source),
  );
  ipcMain.handle("ai:prepare-engine", (_event, engine: unknown) =>
    aiService.prepareEngine(engine),
  );
  ipcMain.handle("ai:chat", async (_event, request: unknown) => {
    try {
      return await aiService.chat(request);
    } finally {
      sendToRenderer("ai:status", "Ready · local only");
    }
  });
  ipcMain.handle("ai:resolve-edits", (_event, ids: unknown, approve: unknown) =>
    aiService.resolveEdits(ids, approve),
  );
  ipcMain.handle("ai:list-history", () => aiService.listHistory());
  ipcMain.handle("ai:revert-history", (_event, id: unknown) =>
    aiService.revertHistory(id),
  );
  ipcMain.handle("ai:stop", () => aiService.stop());
  ipcMain.handle("agent:stop-control", () => agentControlService.stop());
  ipcMain.handle("agent:browser-snapshot", () =>
    agentControlService.browserSnapshot(),
  );
  ipcMain.handle("activity:stop", async () => {
    const stopped = [
      aiService.stopDownload(),
      platformioService.stop(),
      await agentControlService.stop(),
    ];
    return stopped.some(Boolean);
  });
  ipcMain.handle("spellcheck:set", (_event, enabled: unknown) => {
    spellcheckEnabled = enabled !== false;
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.session.spellCheckerEnabled = spellcheckEnabled;
    return spellcheckEnabled;
  });
  ipcMain.handle("project:open", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    await stopProjectProcesses();
    projectRoot = await fs.realpath(result.filePaths[0]);
    return {
      root: projectRoot,
      name: path.basename(projectRoot),
      tree: await tree(projectRoot),
    };
  });
  ipcMain.handle("project:open-path", async (_e, requestedPath: string) => {
    const resolved = path.resolve(requestedPath.trim());
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) throw new Error("That path is not a folder");
    await stopProjectProcesses();
    projectRoot = await fs.realpath(resolved);
    return {
      root: projectRoot,
      name: path.basename(projectRoot),
      tree: await tree(projectRoot),
    };
  });
  ipcMain.handle("project:close", async () => {
    await stopProjectProcesses();
    projectRoot = "";
    return true;
  });
  ipcMain.handle("project:refresh", async () =>
    projectRoot ? tree(projectRoot) : [],
  );
  ipcMain.handle("project:search", (_event, query: unknown) =>
    searchProject(query),
  );
  ipcMain.handle("project:list-directory", async (_e, target: string) =>
    tree(await safeProjectPath(target)),
  );
  ipcMain.handle(
    "project:create-item",
    async (_e, directory: string, requestedName: string, kind: string) => {
      if (kind !== "file" && kind !== "folder")
        throw new Error("Unsupported project item type");
      const parent = await safeProjectPath(directory);
      if (!(await fs.stat(parent)).isDirectory())
        throw new Error("Select a folder for the new item");
      const name = projectItemName(requestedName);
      const destination = path.join(parent, name);
      if (!withinRoot(destination))
        throw new Error("Path is outside the project");
      if (kind === "folder") await fs.mkdir(destination);
      else {
        const handle = await fs.open(destination, "wx");
        await handle.close();
      }
      return {
        tree: await tree(projectRoot),
        item: {
          name,
          path: destination,
          kind: kind === "folder" ? "directory" : "file",
        },
      };
    },
  );
  ipcMain.handle(
    "project:rename-item",
    async (_e, target: string, requestedName: string) => {
      const current = await safeProjectPath(target);
      const root = await fs.realpath(projectRoot);
      if (current === root)
        throw new Error("The project root cannot be renamed here");
      const name = projectItemName(requestedName);
      const destination = path.join(path.dirname(current), name);
      if (!withinRoot(destination))
        throw new Error("Path is outside the project");
      if (await fs.lstat(destination).catch(() => null))
        throw new Error("An item with that name already exists");
      await fs.rename(current, destination);
      return { tree: await tree(projectRoot), newPath: destination, name };
    },
  );
  ipcMain.handle(
    "project:trash-item",
    async (_e, target: string, rawUnsaved: unknown) => {
      const current = await safeProjectPath(target);
      const root = await fs.realpath(projectRoot);
      if (current === root)
        throw new Error("The project root cannot be removed here");
      const options = {
        type: "warning" as const,
        title: "Move project item to Trash?",
        message: `Move “${path.basename(current)}” to ${process.platform === "win32" ? "the Recycle Bin" : "Trash"}?`,
        detail:
          rawUnsaved === true
            ? "Unsaved editor changes inside this item will be lost. The saved files can normally be restored from Trash."
            : "This removes it from the project, but it can normally be restored.",
        buttons: ["Cancel", "Move to Trash"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const result = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options);
      if (result.response !== 1)
        return { deleted: false, tree: await tree(projectRoot) };
      await shell.trashItem(current);
      return { deleted: true, tree: await tree(projectRoot) };
    },
  );
  ipcMain.handle(
    "markdown:read-image",
    async (_e, rawMarkdownPath: unknown, rawSource: unknown) => {
      if (typeof rawMarkdownPath !== "string" || typeof rawSource !== "string")
        throw new Error("Invalid Markdown image");
      const source = rawSource.split(/[?#]/, 1)[0];
      if (
        !source ||
        /^[a-z][a-z0-9+.-]*:/i.test(source) ||
        path.isAbsolute(source)
      )
        throw new Error("Only project-relative images can be loaded");
      let decoded = source;
      try {
        decoded = decodeURIComponent(source);
      } catch {
        throw new Error("Invalid Markdown image path");
      }
      const markdownFile = await safeProjectPath(rawMarkdownPath);
      const imageFile = await safeProjectPath(
        path.resolve(path.dirname(markdownFile), decoded),
      );
      const extension = path.extname(imageFile).toLowerCase();
      const mime = new Map([
        [".png", "image/png"],
        [".jpg", "image/jpeg"],
        [".jpeg", "image/jpeg"],
        [".gif", "image/gif"],
        [".webp", "image/webp"],
      ]).get(extension);
      if (!mime) throw new Error("Unsupported Markdown image format");
      const stat = await fs.stat(imageFile);
      if (!stat.isFile() || stat.size > 10 * 1024 * 1024)
        throw new Error("Markdown image is too large");
      return `data:${mime};base64,${(await fs.readFile(imageFile)).toString("base64")}`;
    },
  );
  ipcMain.handle("file:read", async (_e, target: string) => {
    const file = await safeProjectPath(target);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error("Only regular files can be opened");
    return decodeTextFile(await fs.readFile(file));
  });
  ipcMain.handle("file:write", async (_e, target: string, content: unknown) => {
    await fs.writeFile(
      await safeProjectPath(target),
      validateTextContent(content),
      "utf8",
    );
    return true;
  });
  ipcMain.handle("git:state", gitState);
  ipcMain.handle("git:run", async (_e, action: string, payload?: string) => {
    const remote = action === "remote" ? validateGitRemote(payload) : "";
    const commitReference = async (value: unknown) => {
      const reference = String(value || "").trim();
      if (!/^[a-f0-9]{7,40}$/i.test(reference))
        throw new Error("Choose a valid commit");
      return (
        await git(["rev-parse", "--verify", `${reference}^{commit}`])
      ).trim();
    };
    const commitTarget = async () => {
      let value: { name?: unknown; reference?: unknown };
      try {
        value = JSON.parse(String(payload || "")) as typeof value;
      } catch {
        throw new Error("Choose a valid commit action");
      }
      return {
        name: validateGitBranch(value.name),
        reference: await commitReference(value.reference),
      };
    };
    if (["fetch", "pull", "push"].includes(action)) {
      const state = await gitState();
      if (!state.remote)
        throw new Error("Add a remote destination before syncing");
    }
    const commands: Record<string, string[]> = {
      addAll: ["add", "-A"],
      fetch: ["fetch", "origin"],
      pull: ["pull"],
      push: ["push", "-u", "origin", "HEAD"],
    };
    if (action === "init") {
      try {
        await git(["init", "-b", "main"]);
      } catch {
        await git(["init"]);
      }
      await ensureLocalGitIdentity();
    } else if (["stage", "unstage"].includes(action)) {
      const state = await gitState();
      const file = state.files.find((entry) => entry.path === payload);
      if (!file) throw new Error("That changed file is no longer available");
      const paths = file.originalPath
        ? [file.originalPath, file.path]
        : [file.path];
      if (action === "stage") await git(["add", "-A", "--", ...paths]);
      else {
        try {
          await git(["restore", "--staged", "--", ...paths]);
        } catch {
          await git(["rm", "--cached", "--ignore-unmatch", "--", ...paths]);
        }
      }
    } else if (action === "commit") {
      await ensureLocalGitIdentity();
      await git(["commit", "-m", payload || "Update project"]);
    } else if (action === "remote") {
      try {
        await git(["remote", "set-url", "origin", remote]);
      } catch {
        await git(["remote", "add", "origin", remote]);
      }
    } else if (action === "remoteRemove")
      await git(["remote", "remove", "origin"]);
    else if (action === "branchRename") {
      const branch = validateGitBranch(payload);
      await git(["branch", "-m", branch]);
    } else if (action === "stashCreate") {
      await git([
        "stash",
        "push",
        "-u",
        "-m",
        (payload || "osCode checkpoint").slice(0, 160),
      ]);
    } else if (["stashApply", "stashPop", "stashDrop"].includes(action)) {
      if (!/^stash@\{\d+\}$/.test(payload || ""))
        throw new Error("Invalid stash selection");
      const command =
        action === "stashApply"
          ? "apply"
          : action === "stashPop"
            ? "pop"
            : "drop";
      await git(["stash", command, payload!]);
    } else if (action === "tagCreate") {
      const tag = validateGitBranch(payload);
      await git(["tag", tag]);
    } else if (action === "tagDelete") {
      const tag = validateGitBranch(payload);
      await git(["tag", "-d", tag]);
    } else if (action === "branchCreateAt") {
      const target = await commitTarget();
      const state = await gitState();
      if (state.branches.includes(target.name))
        throw new Error("That branch already exists");
      await git(["switch", "-c", target.name, target.reference]);
    } else if (action === "tagCreateAt") {
      const target = await commitTarget();
      await git(["tag", target.name, target.reference]);
    } else if (action === "cherryPick" || action === "revertCommit") {
      const reference = await commitReference(payload);
      await ensureLocalGitIdentity();
      await git(
        action === "cherryPick"
          ? ["cherry-pick", reference]
          : ["revert", "--no-edit", reference],
      );
    } else if (action === "checkoutDetached") {
      const reference = await commitReference(payload);
      await git(["switch", "--detach", reference]);
    } else if (
      ["branchCreate", "branchSwitch", "branchDelete", "merge"].includes(action)
    ) {
      const branch = validateGitBranch(payload);
      await git(["check-ref-format", "--branch", branch]);
      const state = await gitState();
      if (action === "branchCreate") {
        if (state.branches.includes(branch))
          throw new Error("That branch already exists");
        await git(["switch", "-c", branch]);
      } else {
        if (!state.branches.includes(branch))
          throw new Error("That local branch no longer exists");
        if (action === "branchSwitch") await git(["switch", branch]);
        else if (action === "branchDelete") {
          if (branch === state.branch)
            throw new Error("Switch branches before deleting this one");
          const options = {
            type: "warning" as const,
            title: "Delete local branch?",
            message: `Delete “${branch}”?`,
            detail:
              "Git will refuse if the branch contains unmerged work. Remote branches are not changed.",
            buttons: ["Cancel", "Delete local branch"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          };
          const result = smokeMode
            ? { response: 1 }
            : mainWindow
              ? await dialog.showMessageBox(mainWindow, options)
              : await dialog.showMessageBox(options);
          if (result.response !== 1) return state;
          await git(["branch", "-d", branch]);
        } else {
          if (branch === state.branch)
            throw new Error("Choose another branch to merge");
          await git(["merge", "--no-edit", branch]);
        }
      }
    } else if (commands[action]) await git(commands[action]);
    else throw new Error("Unsupported Git action");
    return gitState();
  });
  ipcMain.handle("git:delete-repository", async () => {
    if (!projectRoot) throw new Error("Open a project first");
    const state = await gitState();
    if (!state.initialized) return state;
    const root = await fs.realpath(projectRoot);
    const metadata = path.join(root, ".git");
    const item = await fs.lstat(metadata).catch(() => null);
    if (!item || item.isSymbolicLink())
      throw new Error("The repository metadata could not be removed safely");
    const options = {
      type: "warning" as const,
      title: "Remove local Git repository?",
      message: "Remove Git history from this project?",
      detail:
        "Your project files stay in place. The local .git metadata will be moved to Trash, and any remote link will be removed with it.",
      buttons: ["Cancel", "Remove local repository"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 1) return state;
    await shell.trashItem(metadata);
    return gitState();
  });
  ipcMain.handle("git:absorb-submodule", async (_e, sub: string) => {
    const state = await gitState();
    if (
      !state.submodules.some((item) => item.path === sub) ||
      !withinRoot(path.join(projectRoot, sub))
    )
      throw new Error("Invalid submodule path");
    const submoduleRoot = await safeProjectPath(path.join(projectRoot, sub));
    const nestedGit = path.join(submoduleRoot, ".git");
    const nestedGitStat = await fs.lstat(nestedGit).catch(() => null);
    if (nestedGitStat?.isDirectory())
      throw new Error(
        "The nested repository has its own Git directory and was left unchanged",
      );
    const moduleConfig = await git([
      "config",
      "-f",
      ".gitmodules",
      "--get-regexp",
      "^submodule\..*\.path$",
    ]);
    const entry = moduleConfig
      .split("\n")
      .map((line) => {
        const separator = line.indexOf(" ");
        return {
          key: line.slice(0, separator),
          value: line.slice(separator + 1).trim(),
        };
      })
      .find((item) => item.value === sub);
    if (!entry)
      throw new Error("Submodule metadata could not be matched safely");
    await git(["rm", "-f", "--cached", "--", sub]);
    if (nestedGitStat?.isFile()) await fs.rm(nestedGit);
    await git([
      "config",
      "-f",
      ".gitmodules",
      "--remove-section",
      entry.key.slice(0, -".path".length),
    ]);
    const gitmodules = path.join(projectRoot, ".gitmodules");
    if ((await fs.readFile(gitmodules, "utf8")).trim())
      await git(["add", "--", ".gitmodules"]);
    else {
      await fs.rm(gitmodules);
      await git(["rm", "--cached", "--ignore-unmatch", "--", ".gitmodules"]);
    }
    await git(["add", "--", sub]);
    return gitState();
  });
  ipcMain.handle(
    "terminal:create",
    async (_e, rawId: string, interpreter = "") => {
      const id = validateTerminalId(rawId);
      if (!terminals.has(id) && terminals.size >= 8)
        throw new Error("Close a terminal before opening another one");
      const isWin = process.platform === "win32";
      const command = isWin
        ? "powershell.exe"
        : process.env.SHELL || "/bin/bash";
      const terminalEnv: Record<string, string> = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      const pathKey =
        Object.keys(terminalEnv).find((key) => key.toLowerCase() === "path") ||
        "PATH";
      const uv = await uvExecutable();
      if (path.isAbsolute(uv))
        terminalEnv[pathKey] =
          `${path.dirname(uv)}${path.delimiter}${terminalEnv[pathKey] || ""}`;
      if (interpreter) {
        const inspected = await inspectPython(interpreter);
        const binaryDir = path.dirname(inspected.path);
        const parent = path.dirname(binaryDir);
        const looksLikeVenv = ["scripts", "bin"].includes(
          path.basename(binaryDir).toLowerCase(),
        );
        if (looksLikeVenv) {
          terminalEnv.VIRTUAL_ENV = parent;
          terminalEnv[pathKey] =
            `${binaryDir}${path.delimiter}${terminalEnv[pathKey] || ""}`;
        }
      }
      terminals.get(id)?.kill();
      const terminal = pty.spawn(
        command,
        isWin
          ? ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass"]
          : ["-l"],
        {
          cwd: projectRoot || app.getPath("home"),
          env: terminalEnv,
          cols: 100,
          rows: 30,
          name: "xterm-256color",
        },
      );
      terminals.set(id, terminal);
      terminal.onData((data) => sendToRenderer("terminal:data", id, data));
      terminal.onExit(({ exitCode }) => {
        if (terminals.get(id) === terminal) terminals.delete(id);
        sendToRenderer("terminal:data", id, `\r\n[process exited ${exitCode}]`);
      });
      return { shell: path.basename(command) };
    },
  );
  ipcMain.on("terminal:write", (_e, rawId: string, rawData: string) => {
    try {
      const id = validateTerminalId(rawId);
      terminals.get(id)?.write(validateTerminalInput(rawData));
    } catch {
      /* ignore malformed fire-and-forget terminal events */
    }
  });
  ipcMain.on(
    "terminal:resize",
    (_e, rawId: string, cols: number, rows: number) => {
      try {
        const id = validateTerminalId(rawId);
        if (validTerminalSize(cols, rows))
          terminals.get(id)?.resize(cols, rows);
      } catch {
        /* ignore malformed fire-and-forget terminal events */
      }
    },
  );
  ipcMain.handle("terminal:dispose", async (_e, rawId: string) => {
    const id = validateTerminalId(rawId);
    await disposeTerminal(id);
    return true;
  });
  ipcMain.handle("python:list", async () => {
    const contained = await containedPythonList();
    const discovered = await Promise.all(
      managedPythonVersions.map(async (version) => {
        const local = contained.get(version);
        if (local) return local;
        const systemCommand =
          process.platform === "win32" ? "py" : `python${version}`;
        const systemArgs =
          process.platform === "win32"
            ? [`-${version}`, "-c", "import sys;print(sys.executable)"]
            : ["-c", "import sys;print(sys.executable)"];
        try {
          const { stdout } = await exec(systemCommand, systemArgs);
          return { version, path: stdout.trim(), installed: true };
        } catch {
          try {
            const { stdout } = await exec(
              await uvExecutable(),
              ["python", "find", version],
              {
                env: {
                  ...process.env,
                  UV_PYTHON_INSTALL_DIR: managedPythonRoot(),
                },
              },
            );
            return { version, path: stdout.trim(), installed: true };
          } catch {
            return { version, path: "", installed: false };
          }
        }
      }),
    );
    const custom = await customPythonList();
    const knownPaths = new Set(
      discovered
        .filter((item) => item.path)
        .map((item) =>
          process.platform === "win32" ? item.path.toLowerCase() : item.path,
        ),
    );
    discovered.unshift(
      ...custom.filter(
        (item) =>
          !knownPaths.has(
            process.platform === "win32" ? item.path.toLowerCase() : item.path,
          ),
      ),
    );
    const projectRuntimes: PythonRuntimeRecord[] = [];
    const venvPython = projectRoot
      ? path.join(
          projectRoot,
          ".venv",
          process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
        )
      : "";
    if (venvPython) {
      try {
        const inspected = await inspectPython(venvPython);
        projectRuntimes.push({
          version: `Project .venv · ${inspected.fullVersion}`,
          path: inspected.path,
          installed: true,
        });
      } catch {
        /* no project environment */
      }
    }
    if (projectRoot) {
      const namedRoot = await projectPrivateDirectory(
        [".oscode", "envs"],
        false,
      ).catch(() => "");
      if (!namedRoot) return [...projectRuntimes, ...discovered];
      const names = await fs
        .readdir(namedRoot, { withFileTypes: true })
        .catch(() => []);
      for (const entry of names
        .filter((x) => x.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))) {
        const python = path.join(
          namedRoot,
          entry.name,
          process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
        );
        try {
          const inspected = await inspectPython(python);
          projectRuntimes.push({
            version: `Project: ${entry.name} · ${inspected.fullVersion}`,
            path: inspected.path,
            installed: true,
          });
        } catch {
          /* ignore incomplete environment */
        }
      }
    }
    return [...projectRuntimes, ...discovered];
  });
  ipcMain.handle("python:get-selection", async () => {
    if (!projectRoot) return "";
    const root = await fs.realpath(projectRoot);
    const selections = await readPythonSelections();
    const selected = selections[root];
    if (!selected) return "";
    try {
      return (await inspectPython(selected)).path;
    } catch {
      await savePythonSelections(setPythonSelection(selections, root, ""));
      return "";
    }
  });
  ipcMain.handle("python:set-selection", async (_e, interpreter: string) => {
    if (!projectRoot) return false;
    if (typeof interpreter !== "string")
      throw new Error("Invalid Python interpreter selection");
    const root = await fs.realpath(projectRoot);
    const selected = interpreter ? (await inspectPython(interpreter)).path : "";
    const selections = setPythonSelection(
      await readPythonSelections(),
      root,
      selected,
    );
    await savePythonSelections(selections);
    return true;
  });
  ipcMain.handle("python:choose", async () => {
    const selected = await dialog.showOpenDialog({
      title: "Choose a Python interpreter",
      properties: ["openFile"],
      filters:
        process.platform === "win32"
          ? [{ name: "Python executable", extensions: ["exe"] }]
          : undefined,
    });
    if (selected.canceled) return null;
    const inspected = await inspectPython(selected.filePaths[0]);
    const executable = inspected.path;
    const runtime = {
      version: `Local ${inspected.fullVersion}`,
      path: executable,
      installed: true,
    };
    const existing = await customPythonList();
    const normalized =
      process.platform === "win32" ? executable.toLowerCase() : executable;
    await saveCustomPython([
      runtime,
      ...existing.filter(
        (item) =>
          (process.platform === "win32"
            ? item.path.toLowerCase()
            : item.path) !== normalized,
      ),
    ]);
    return runtime;
  });
  ipcMain.handle(
    "python:create-venv",
    async (_e, interpreter: string, requestedName = "") => {
      if (!projectRoot) throw new Error("Open a project first");
      if (!interpreter) throw new Error("Select a Python interpreter first");
      const name = requestedName.trim();
      if (name && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/.test(name))
        throw new Error(
          "Environment names may use letters, numbers, dashes, and underscores",
        );
      const destination = name
        ? path.join(
            await projectPrivateDirectory([".oscode", "envs"], true),
            name,
          )
        : path.join(await fs.realpath(projectRoot), ".venv");
      if (!withinRoot(destination))
        throw new Error("Environment path is outside the project");
      if (await fs.lstat(destination).catch(() => null))
        throw new Error(
          name
            ? `Environment “${name}” already exists`
            : "Project .venv already exists",
        );
      const base = await inspectPython(interpreter);
      try {
        await exec(base.path, ["-m", "venv", destination], {
          cwd: projectRoot,
        });
        const python = path.join(
          destination,
          process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
        );
        const created = await inspectPython(python);
        return {
          version: name
            ? `Project: ${name} · ${created.fullVersion}`
            : `Project .venv · ${created.fullVersion}`,
          path: created.path,
          installed: true,
        };
      } catch (error) {
        await fs.rm(destination, { recursive: true, force: true });
        throw error;
      }
    },
  );
  ipcMain.handle("python:install", async (_e, version: string) => {
    if (!managedPythonVersions.includes(version))
      throw new Error("Invalid Python version");
    try {
      await fs.mkdir(managedPythonRoot(), { recursive: true });
      await exec(
        await uvExecutable(),
        ["python", "install", "--install-dir", managedPythonRoot(), version],
        {
          timeout: 10 * 60_000,
          env: {
            ...process.env,
            UV_PYTHON_INSTALL_DIR: managedPythonRoot(),
            UV_PYTHON_NO_REGISTRY: "1",
            UV_PYTHON_INSTALL_BIN: "0",
          },
        },
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/ENOENT|not recognized|not found/i.test(message)) return false;
      throw error;
    }
  });
  ipcMain.handle(
    "python:run",
    async (_e, file: string, interpreter: string, debug = false) => {
      const script = await safeProjectPath(file);
      if (path.extname(script) !== ".py")
        throw new Error("Select a Python file in the current project");
      if (!interpreter) throw new Error("Select a Python interpreter first");
      const inspected = await inspectPython(interpreter);
      runningScript?.kill();
      runningDebug = debug;
      const command = inspected.path;
      const scriptArgs = debug ? ["-m", "pdb", script] : [script];
      const args = scriptArgs;
      const child = spawn(command, args, {
        cwd: projectRoot,
        env: process.env,
      });
      runningScript = child;
      mainWindow?.webContents.send(
        "run:data",
        `› ${path.basename(command)} ${path.basename(script)}\r\n`,
      );
      child.stdout?.on("data", (data) =>
        mainWindow?.webContents.send("run:data", data.toString()),
      );
      child.stderr?.on("data", (data) =>
        mainWindow?.webContents.send("run:data", data.toString()),
      );
      child.on("error", (error) => {
        if (runningScript !== child) return;
        mainWindow?.webContents.send(
          "run:data",
          `\r\nProcess could not start: ${error.message}\r\n`,
        );
        mainWindow?.webContents.send("run:stopped");
        runningScript = null;
        runningDebug = false;
      });
      child.on("exit", (code) => {
        if (runningScript !== child) return;
        mainWindow?.webContents.send(
          "run:data",
          `\r\nProcess finished with exit code ${code ?? "unknown"}\r\n`,
        );
        mainWindow?.webContents.send("run:stopped");
        runningScript = null;
        runningDebug = false;
      });
      return true;
    },
  );
  ipcMain.handle("python:stop", () => {
    const child = runningScript;
    runningScript = null;
    runningDebug = false;
    if (child) {
      child.kill();
      mainWindow?.webContents.send("run:data", "\r\nProcess stopped\r\n");
      mainWindow?.webContents.send("run:stopped");
    }
    return true;
  });
  ipcMain.handle("python:input", (_e, data: string) => {
    if (typeof data !== "string" || data.length === 0 || data.length > 10_000)
      throw new Error("Invalid process input");
    if (!runningScript?.stdin?.writable)
      throw new Error("No Python process is accepting input");
    runningScript.stdin.write(data);
    return true;
  });
}
app.whenReady().then(() => {
  appUpdateService = new AppUpdateService((status) =>
    sendToRenderer("updates:status-changed", status),
  );
  const developmentOrigin =
    !app.isPackaged && process.env.VITE_DEV_SERVER_URL
      ? new URL(process.env.VITE_DEV_SERVER_URL).origin
      : "";
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      let allowDevelopmentRenderer = false;
      if (developmentOrigin) {
        try {
          allowDevelopmentRenderer =
            new URL(details.url).origin === developmentOrigin;
        } catch {
          allowDevelopmentRenderer = false;
        }
      }
      callback({ cancel: !allowDevelopmentRenderer });
    },
  );
  agentControlService = new AgentControlService(
    () => mainWindow,
    () => projectRoot,
    (activity) => sendToRenderer("agent:activity", activity),
    false,
  );
  aiService = new LocalAiService({
    userData: app.getPath("userData"),
    modelsRoot: path.join(app.getPath("userData"), "models"),
    llamaRoot: app.isPackaged
      ? path.join(process.resourcesPath, "llama")
      : path.join(app.getAppPath(), "vendor", "llama"),
    getProjectRoot: () => projectRoot,
    getUv: uvExecutable,
    getPython: async () => {
      const runtimes = await containedPythonList();
      const python =
        runtimes.get("3.12")?.path || [...runtimes.values()][0]?.path;
      if (!python) throw new Error("The bundled Python runtime is unavailable");
      return python;
    },
    status: (message) => sendToRenderer("ai:status", message),
    activity: (activity) => sendToRenderer("agent:activity", activity),
    platformioState: () => platformioService.state(projectRoot),
    platformioRun: (action, environment) =>
      platformioService.run(action, environment, projectRoot),
    browserOpen: (url) => agentControlService.openBrowser(url),
    browserInspect: () => agentControlService.inspectBrowser(),
    browserClick: (query) => agentControlService.clickBrowser(query),
    browserType: (query, text) => agentControlService.typeBrowser(query, text),
    browserClose: () => agentControlService.closeBrowser(),
    computerList: () => agentControlService.listComputerTargets(),
    computerInspect: (target) => agentControlService.inspectComputer(target),
    computerClick: (query, target) =>
      agentControlService.clickComputer(query, target),
    computerType: (query, text, target) =>
      agentControlService.typeComputer(query, text, target),
  });
  platformioService = new PlatformioService(
    path.join(app.getPath("userData"), "platformio"),
    async () => {
      const runtimes = await containedPythonList();
      const python =
        runtimes.get("3.12")?.path || [...runtimes.values()][0]?.path;
      if (!python) throw new Error("The bundled Python runtime is unavailable");
      return python;
    },
    (data) => sendToRenderer("platformio:output", data),
  );
  registerIpc();
  createWindow(!smokeMode);
  createApplicationMenu();
  void readPreferences().then((preferences) => {
    spellcheckEnabled = preferences.spellcheck;
    appUpdateService.initialize(preferences.autoUpdateEnabled);
  });
  if (smokeMode && mainWindow) void runSmokeTest(mainWindow);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (event) => {
  appUpdateService?.dispose();
  if (quittingAfterCleanup) return;
  platformioService?.stop();
  if (rendererHasUnsavedChanges) {
    event.preventDefault();
    if (closeConfirmationOpen) return;
    closeConfirmationOpen = true;
    void confirmDiscardChanges(
      "Quitting osCode now will discard changes that have not been saved.",
    ).then(async (discard) => {
      closeConfirmationOpen = false;
      if (!discard) return;
      rendererHasUnsavedChanges = false;
      allowWindowClose = true;
      quittingAfterCleanup = true;
      await stopProjectProcesses();
      await aiService.dispose();
      app.quit();
    });
    return;
  }
  if (
    !runningScript &&
    terminals.size === 0 &&
    !agentControlService?.isActive()
  ) {
    void aiService.dispose();
    return;
  }
  event.preventDefault();
  quittingAfterCleanup = true;
  void stopProjectProcesses()
    .then(() => aiService.dispose())
    .finally(() => app.quit());
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
