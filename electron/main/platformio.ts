import fs from "node:fs/promises";
import path from "node:path";
import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";
import { SecureDataStore } from "./secure-store.js";

const exec = promisify(execFile);

export type PlatformioState = {
  installed: boolean;
  version: string;
  project: boolean;
  environments: string[];
  autoUpdate: boolean;
  running: boolean;
  telemetry: false;
};
export type PlatformioBoard = {
  id: string;
  name: string;
  platform: string;
  frameworks: string[];
};

type PlatformioConfig = { autoUpdate: boolean; lastUpdateCheck: number };
type PlatformioAction = "build" | "upload" | "clean" | "test" | "monitor";

const validEnvironment = (value: string) =>
  !value || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);
const validBoard = (value: string) =>
  /^[A-Za-z0-9][A-Za-z0-9_.-]{1,79}$/.test(value);
const validFramework = (value: string) =>
  !value || /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(value);

export class PlatformioService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly secure: SecureDataStore;

  constructor(
    private readonly dataRoot: string,
    private readonly getPython: () => Promise<string>,
    private readonly output: (data: string) => void,
    secureStore?: SecureDataStore,
  ) {
    this.secure = secureStore || new SecureDataStore(dataRoot);
  }

  private get penvRoot() {
    return path.join(this.dataRoot, "penv");
  }

  private get pioExecutable() {
    return process.platform === "win32"
      ? path.join(this.penvRoot, "Scripts", "pio.exe")
      : path.join(this.penvRoot, "bin", "pio");
  }

  private get configPath() {
    return path.join(this.secure.root, "state", "platformio.oscode-data");
  }

  private get legacyConfigPath() {
    return path.join(this.dataRoot, "oscode.json");
  }

  private get boardsPath() {
    return path.join(this.dataRoot, "boards.json");
  }

  private environment() {
    return {
      ...process.env,
      PLATFORMIO_CORE_DIR: path.join(this.dataRoot, "core"),
      PLATFORMIO_SETTING_ENABLE_TELEMETRY: "false",
      PLATFORMIO_DISABLE_UPGRADE_CHECK: "true",
      PLATFORMIO_NO_ANSI: "true",
      PLATFORMIO_DISABLE_PROGRESSBAR: "true",
      CI: "true",
    };
  }

  private async config(): Promise<PlatformioConfig> {
    const value = await this.secure.readJson<Partial<PlatformioConfig>>(
      this.configPath,
      {},
      "platformio-preferences",
      this.legacyConfigPath,
    );
    return {
      autoUpdate: value.autoUpdate === true,
      lastUpdateCheck: Number.isFinite(value.lastUpdateCheck)
        ? Number(value.lastUpdateCheck)
        : 0,
    };
  }

  private async saveConfig(config: PlatformioConfig) {
    await this.secure.writeJson(
      this.configPath,
      config,
      "platformio-preferences",
    );
  }

  private async exists(file: string) {
    try {
      return (await fs.stat(file)).isFile();
    } catch {
      return false;
    }
  }

  private async environments(projectRoot: string) {
    if (!projectRoot) return [];
    try {
      const ini = await fs.readFile(
        path.join(projectRoot, "platformio.ini"),
        "utf8",
      );
      return [...ini.matchAll(/^\s*\[env:([^\]\r\n]+)\]\s*$/gim)]
        .map((match) => match[1].trim())
        .filter(
          (name, index, names) =>
            validEnvironment(name) && names.indexOf(name) === index,
        );
    } catch {
      return [];
    }
  }

  async state(projectRoot: string): Promise<PlatformioState> {
    const installed = await this.exists(this.pioExecutable);
    const config = await this.config();
    let version = "";
    if (installed) {
      try {
        const result = await exec(this.pioExecutable, ["--version"], {
          env: this.environment(),
          windowsHide: true,
          timeout: 15_000,
        });
        version = result.stdout
          .trim()
          .replace(/^PlatformIO Core, version\s+/i, "");
      } catch {
        version = "Installed";
      }
    }
    return {
      installed,
      version,
      project: Boolean(
        projectRoot &&
        (await this.exists(path.join(projectRoot, "platformio.ini"))),
      ),
      environments: await this.environments(projectRoot),
      autoUpdate: config.autoUpdate,
      running: Boolean(this.child),
      telemetry: false,
    };
  }

  async install(update = false) {
    if (this.child) throw new Error("A PlatformIO task is already running");
    await fs.mkdir(this.dataRoot, { recursive: true });
    const basePython = await this.getPython();
    const penvPython =
      process.platform === "win32"
        ? path.join(this.penvRoot, "Scripts", "python.exe")
        : path.join(this.penvRoot, "bin", "python");
    if (!(await this.exists(penvPython))) {
      this.output("Creating PlatformIO's private environment…\n");
      await exec(basePython, ["-m", "venv", this.penvRoot], {
        env: this.environment(),
        windowsHide: true,
        timeout: 120_000,
      });
    }
    this.output(`${update ? "Updating" : "Installing"} PlatformIO Core…\n`);
    const args = [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
    ];
    if (update) args.push("--upgrade");
    args.push("platformio");
    await this.stream(penvPython, args, this.dataRoot);
    await exec(
      this.pioExecutable,
      ["settings", "set", "enable_telemetry", "No"],
      {
        env: this.environment(),
        windowsHide: true,
        timeout: 30_000,
      },
    );
    const config = await this.config();
    await this.saveConfig({ ...config, lastUpdateCheck: Date.now() });
    await this.refreshBoards().catch((error) =>
      this.output(`Board catalogue will refresh later: ${String(error)}\n`),
    );
    this.output("PlatformIO is ready. Telemetry is disabled.\n");
    return true;
  }

  async boards(): Promise<PlatformioBoard[]> {
    if (await this.exists(this.pioExecutable)) {
      const cached = await this.readBoards();
      if (cached.length) return cached;
      return this.refreshBoards();
    }
    return [];
  }

  private async readBoards(): Promise<PlatformioBoard[]> {
    try {
      const value = JSON.parse(await fs.readFile(this.boardsPath, "utf8"));
      return Array.isArray(value)
        ? value.filter(
            (item): item is PlatformioBoard =>
              item &&
              typeof item.id === "string" &&
              typeof item.name === "string" &&
              typeof item.platform === "string" &&
              Array.isArray(item.frameworks),
          )
        : [];
    } catch {
      return [];
    }
  }

  private async refreshBoards(): Promise<PlatformioBoard[]> {
    const result = await exec(this.pioExecutable, ["boards", "--json-output"], {
      env: this.environment(),
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const raw = JSON.parse(result.stdout) as Array<Record<string, unknown>>;
    const boards = raw
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        name: typeof item.name === "string" ? item.name : "",
        platform: typeof item.platform === "string" ? item.platform : "",
        frameworks: Array.isArray(item.frameworks)
          ? item.frameworks.filter(
              (framework): framework is string => typeof framework === "string",
            )
          : [],
      }))
      .filter((item) => item.id && item.name)
      .sort((left, right) => left.name.localeCompare(right.name));
    await fs.mkdir(this.dataRoot, { recursive: true });
    await fs.writeFile(this.boardsPath, `${JSON.stringify(boards)}\n`, "utf8");
    return boards;
  }

  async setAutoUpdate(enabled: boolean) {
    const config = await this.config();
    await this.saveConfig({ ...config, autoUpdate: enabled === true });
    return enabled === true;
  }

  async maybeAutoUpdate() {
    const config = await this.config();
    if (!config.autoUpdate || !(await this.exists(this.pioExecutable)))
      return false;
    if (Date.now() - config.lastUpdateCheck < 86_400_000) return false;
    await this.install(true);
    return true;
  }

  async initialize(projectRoot: string, board: string, framework: string) {
    if (!projectRoot) throw new Error("Open a project first");
    if (!validBoard(board))
      throw new Error("Enter a valid PlatformIO board ID");
    if (!validFramework(framework))
      throw new Error("Enter a valid framework name");
    const args = ["project", "init", "--board", board];
    if (framework) args.push("--project-option", `framework=${framework}`);
    await this.runPio(args, projectRoot);
    return this.state(projectRoot);
  }

  async run(
    action: PlatformioAction,
    environment: string,
    projectRoot: string,
  ) {
    if (!projectRoot) throw new Error("Open a project first");
    if (!(await this.exists(path.join(projectRoot, "platformio.ini"))))
      throw new Error("This folder is not a PlatformIO project");
    if (!validEnvironment(environment))
      throw new Error("Invalid PlatformIO environment");
    const args =
      action === "test"
        ? ["test"]
        : action === "monitor"
          ? ["device", "monitor"]
          : ["run"];
    if (environment) args.push("--environment", environment);
    if (action === "upload") args.push("--target", "upload");
    if (action === "clean") args.push("--target", "clean");
    await this.runPio(args, projectRoot);
    return this.state(projectRoot);
  }

  stop() {
    if (!this.child) return false;
    this.child.kill();
    this.child = null;
    this.output("\nPlatformIO task stopped.\n");
    return true;
  }

  write(data: string) {
    if (!data || data.length > 10_000)
      throw new Error("Invalid PlatformIO input");
    if (!this.child?.stdin.writable)
      throw new Error("No PlatformIO task is accepting input");
    this.child.stdin.write(data);
    return true;
  }

  async dispose() {
    this.stop();
  }

  private async runPio(args: string[], cwd: string) {
    if (!(await this.exists(this.pioExecutable)))
      throw new Error("Install PlatformIO Core first");
    this.output(`\n> pio ${args.join(" ")}\n`);
    await this.stream(this.pioExecutable, args, cwd);
  }

  private stream(command: string, args: string[], cwd: string) {
    if (this.child) throw new Error("A PlatformIO task is already running");
    return new Promise<void>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        env: this.environment(),
        windowsHide: true,
        stdio: "pipe",
      });
      this.child = child;
      child.stdout.on("data", (data) => this.output(String(data)));
      child.stderr.on("data", (data) => this.output(String(data)));
      child.once("error", (error) => {
        if (this.child === child) this.child = null;
        reject(error);
      });
      child.once("exit", (code, signal) => {
        if (this.child === child) this.child = null;
        if (code === 0 || signal) resolve();
        else
          reject(new Error(`PlatformIO exited with code ${code ?? "unknown"}`));
      });
    });
  }
}

export const platformioValidation = {
  validEnvironment,
  validBoard,
  validFramework,
};
