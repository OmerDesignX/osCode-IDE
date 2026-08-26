import {
  app,
  BrowserWindow,
  session,
  type Session,
  type WebContents,
} from "electron";
import { execFile } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  assertReceiveOnlyPublicUrl,
  receiveOnlyBrowserRequest,
  strippedReceiveOnlyHeaders,
} from "./outbound-guard.js";

const execFileAsync = promisify(execFile);

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

type ActivityListener = (activity: AgentActivity) => void;

const blockedNativeTarget =
  /(?:^|[\\/\s._-])(?:powershell|pwsh|cmd|windowsterminal|wt|terminal|credentialuibroker|credential|keepass|1password|bitwarden|authenticator|consent|logonui|securityhealth|windowsdefender|taskmgr|regedit|chrome|msedge|firefox|safari|outlook|mail|slack|teams|discord)(?:\.exe)?(?:$|[\\/\s._-])/i;

function cleanNativeTarget(value: string) {
  const target = value
    .replace(/[\r\n\0]/g, "")
    .trim()
    .slice(0, 160);
  if (!target) throw new Error("Choose a visible application first");
  if (blockedNativeTarget.test(` ${target} `))
    throw new Error(
      "Computer Control cannot operate terminals, credential tools, or system security controls",
    );
  return target;
}

function osCodeTarget(value?: string) {
  return !value || /^(?:oscode|oscode ide)$/i.test(value.trim());
}

function limitedNativeError(error: unknown) {
  const value = error as {
    message?: string;
    stderr?: string | Buffer;
    stdout?: string | Buffer;
  };
  const message = [value?.stderr, value?.stdout, value?.message]
    .map((part) => String(part || "").trim())
    .find(Boolean);
  return (message || "The operating system rejected the action")
    .replace(/\s+/g, " ")
    .slice(0, 500);
}

function parseNativeJson(output: string): unknown {
  const trimmed = output.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const starts = [trimmed.indexOf("["), trimmed.indexOf("{")].filter(
      (index) => index >= 0,
    );
    const start = Math.min(...starts);
    if (Number.isFinite(start)) {
      try {
        return JSON.parse(trimmed.slice(start));
      } catch {}
    }
    return trimmed.slice(0, 80_000);
  }
}

function nativePoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const point = nativePoint(item);
      if (point) return point;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const bounds = record.bounds || record.boundingRectangle || record.frame;
  if (bounds && typeof bounds === "object") {
    const box = bounds as Record<string, unknown>;
    const x = Number(box.x ?? box.left);
    const y = Number(box.y ?? box.top);
    const width = Number(box.width ?? 0);
    const height = Number(box.height ?? 0);
    if (Number.isFinite(x) && Number.isFinite(y))
      return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
  }
  if (Array.isArray(record.position) && Array.isArray(record.size)) {
    const x = Number(record.position[0]);
    const y = Number(record.position[1]);
    const width = Number(record.size[0]);
    const height = Number(record.size[1]);
    if ([x, y, width, height].every(Number.isFinite))
      return { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
  }
  for (const child of Object.values(record)) {
    const point = nativePoint(child);
    if (point) return point;
  }
  return null;
}

function privateAddress(address: string) {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIPv4(normalized)) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    );
  }
  if (net.isIPv6(normalized))
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    );
  return false;
}

function loopbackHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

export function cleanBrowserAddress(raw: string) {
  let input = raw
    .replace(/[\r\n\0]/g, "")
    .trim()
    .slice(0, 2_000);
  const first = input.at(0);
  const last = input.at(-1);
  if (
    input.length >= 2 &&
    first === last &&
    (first === '"' || first === "'" || first === "`")
  )
    input = input.slice(1, -1).trim();
  return input;
}

async function projectFileFromStalePath(root: string, requested: string) {
  const project = await fs.realpath(root);
  const parsedRoot = path.parse(requested).root;
  const parts = path
    .normalize(requested)
    .split(path.sep)
    .filter((part) => part && part !== parsedRoot);
  for (let index = 0; index < parts.length; index += 1) {
    const candidate = path.join(project, ...parts.slice(index));
    const resolved = await fs.realpath(candidate).catch(() => "");
    if (!resolved) continue;
    const relative = path.relative(project, resolved);
    const stat = await fs.stat(resolved).catch(() => null);
    if (
      stat?.isFile() &&
      !relative.startsWith("..") &&
      !path.isAbsolute(relative)
    )
      return resolved;
  }
  return "";
}

async function validatedAddress(raw: string, projectRoot: string) {
  const input = cleanBrowserAddress(raw);
  if (!input) throw new Error("Enter a page address");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    const candidate = path.resolve(projectRoot, input);
    const relative = path.relative(projectRoot, candidate);
    if (!relative.startsWith("..") && !path.isAbsolute(relative))
      url = pathToFileURL(await fs.realpath(candidate));
    else url = new URL(`https://${input}`);
  }
  if (url.username || url.password)
    throw new Error("Addresses containing credentials are blocked");
  if (url.protocol === "file:") {
    const requested = (() => {
      try {
        return fileURLToPath(url);
      } catch {
        return decodeURIComponent(url.pathname);
      }
    })();
    const root = await fs.realpath(projectRoot);
    let file = await fs.realpath(requested).catch(() => "");
    let relative = file ? path.relative(root, file) : "";
    if (!file || relative.startsWith("..") || path.isAbsolute(relative)) {
      file = await projectFileFromStalePath(root, requested);
      relative = file ? path.relative(root, file) : "";
    }
    if (!file || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error(
        "That preview is not in the open project. Use an existing project-relative HTML path returned by list_files.",
      );
    return { url: pathToFileURL(file).toString(), network: false };
  }
  if (url.protocol === "http:") {
    if (!loopbackHost(url.hostname))
      throw new Error("Public pages must use HTTPS");
    return { url: url.toString(), network: false };
  }
  if (url.protocol !== "https:")
    throw new Error(
      "Only project files, local previews, and public HTTPS pages are supported",
    );
  if (loopbackHost(url.hostname) || privateAddress(url.hostname))
    throw new Error("Private network pages are blocked");
  const addresses = await dns
    .lookup(url.hostname, { all: true })
    .catch(() => []);
  if (!addresses.length)
    throw new Error("The page address could not be resolved");
  if (addresses.some((entry) => privateAddress(entry.address)))
    throw new Error("Private network pages are blocked");
  assertReceiveOnlyPublicUrl(url.toString());
  return { url: url.toString(), network: true };
}

const inspectScript = `(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const controls = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[tabindex]')]
    .filter(visible)
    .slice(0, 180)
    .map((element, index) => ({
      index,
      tag: element.tagName.toLowerCase(),
      label: (element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || element.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 180),
      type: element.getAttribute('type') || '',
      disabled: Boolean(element.disabled),
    }));
  return JSON.stringify({
    title: document.title,
    url: location.href,
    text: (document.body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 30000),
    controls,
  });
})()`;

const webMcpToolsScript = `(async () => {
  const context = document.modelContext;
  if (!context || typeof context.getTools !== 'function') {
    return JSON.stringify({ supported: false, origin: location.origin, tools: [] });
  }
  const tools = await context.getTools();
  return JSON.stringify({
    supported: true,
    origin: location.origin,
    tools: [...tools].slice(0, 80).map((tool) => ({
      name: String(tool.name || '').slice(0, 160),
      title: String(tool.title || '').slice(0, 240),
      description: String(tool.description || '').slice(0, 1000),
      inputSchema: String(tool.inputSchema || '{}').slice(0, 12000),
      readOnlyHint: tool.readOnlyHint === true,
      untrustedContentHint: tool.untrustedContentHint !== false,
      origin: String(tool.origin || location.origin).slice(0, 500),
    })),
  });
})()`;

function webMcpCallScript(rawName: string, rawArguments: unknown) {
  const name = JSON.stringify(rawName.slice(0, 160));
  const argumentsValue = JSON.stringify(rawArguments ?? {});
  return `(async () => {
    const context = document.modelContext;
    if (!context || typeof context.getTools !== 'function' || typeof context.executeTool !== 'function')
      throw new Error('This page does not expose WebMCP tools');
    const tools = [...await context.getTools()];
    const tool = tools.find((candidate) => candidate.name === ${name});
    if (!tool) throw new Error('The requested WebMCP tool is no longer available');
    if (tool.readOnlyHint !== true)
      throw new Error('osCode only permits WebMCP tools explicitly marked read-only');
    const result = await context.executeTool(tool, ${argumentsValue});
    return JSON.stringify({
      tool: tool.name,
      origin: String(tool.origin || location.origin).slice(0, 500),
      result,
      untrusted: true,
    });
  })()`;
}

function targetScript(
  rawQuery: string,
  action: "point" | "click" | "type",
  text = "",
) {
  const query = JSON.stringify(rawQuery.trim().slice(0, 300));
  const value = JSON.stringify(text.slice(0, 20_000));
  return `(() => {
    const query = ${query}.toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    let element = null;
    try { element = document.querySelector(${query}); } catch {}
    if (!element) {
      element = [...document.querySelectorAll('a,button,input,textarea,select,[role="button"],[tabindex]')]
        .filter(visible)
        .find((candidate) => {
          const label = (candidate.getAttribute('aria-label') || candidate.getAttribute('title') || candidate.getAttribute('placeholder') || candidate.textContent || '').trim().replace(/\\s+/g, ' ').toLowerCase();
          return label === query || label.includes(query);
        }) || null;
    }
    if (!element || !visible(element)) throw new Error('No visible control matched that description');
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    let cursor = document.getElementById('oscode-agent-cursor');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.id = 'oscode-agent-cursor';
      cursor.setAttribute('aria-hidden', 'true');
      Object.assign(cursor.style, {
        position: 'fixed', width: '20px', height: '20px', border: '2px solid #89cff0',
        borderRadius: '50% 50% 50% 12%', transform: 'rotate(-35deg)', pointerEvents: 'none',
        zIndex: '2147483647', boxShadow: '0 0 0 3px rgba(137,207,240,.22)',
        transition: 'left 120ms ease, top 120ms ease',
      });
      document.documentElement.appendChild(cursor);
    }
    cursor.style.left = Math.max(0, rect.left + rect.width / 2 - 10) + 'px';
    cursor.style.top = Math.max(0, rect.top + rect.height / 2 - 10) + 'px';
    if (${JSON.stringify(action)} === 'click') element.click();
    if (${JSON.stringify(action)} === 'type') {
      element.focus();
      const next = ${value};
      if ('value' in element) {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (setter) setter.call(element, next); else element.value = next;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (element.isContentEditable) {
        element.textContent = next;
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: next }));
      } else throw new Error('The matched control does not accept text');
    }
    return JSON.stringify({ label: (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().slice(0, 180), x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) });
  })()`;
}

async function execute(contents: WebContents, script: string) {
  if (contents.isDestroyed())
    throw new Error("The controlled window is closed");
  return String(await contents.executeJavaScript(script, true));
}

export class AgentControlService {
  private browser: BrowserWindow | null = null;
  private browserSession: Session | null = null;
  private cursorOverlay: BrowserWindow | null = null;
  private nativeAbort: AbortController | null = null;
  private activeComputer = false;
  constructor(
    private readonly main: () => BrowserWindow | null,
    private readonly projectRoot: () => string,
    private readonly activity: ActivityListener,
    private readonly visible = true,
  ) {}

  private emit(activity: AgentActivity) {
    this.activity(activity);
  }

  private blockedOutbound(reason: string, url = "") {
    this.emit({
      kind: "security",
      label: `Blocked outbound data · ${reason}`,
      active: true,
      network: false,
      url,
      cancellable: false,
    });
  }

  private nativeHelperPath() {
    if (process.platform === "win32")
      return app.isPackaged
        ? path.join(
            process.resourcesPath,
            "computer-control",
            "win32-x64",
            "winapp.exe",
          )
        : path.join(
            app.getAppPath(),
            "node_modules",
            "@microsoft",
            "winappcli",
            "bin",
            "win-x64",
            "winapp.exe",
          );
    if (process.platform === "darwin")
      return app.isPackaged
        ? path.join(
            process.resourcesPath,
            "computer-control",
            "darwin-universal",
            "oscode-computer-control",
          )
        : path.join(
            app.getAppPath(),
            "vendor",
            "computer-control",
            "darwin-universal",
            "oscode-computer-control",
          );
    throw new Error(
      "Native Computer Control is available on Windows and macOS. osCode and the dedicated agent browser remain controllable on Linux.",
    );
  }

  private async nativeOutput(args: string[], timeout = 20_000) {
    const executable = this.nativeHelperPath();
    await fs.access(executable).catch(() => {
      throw new Error(
        "The bundled Computer Control component is missing. Reinstall osCode.",
      );
    });
    const controller = new AbortController();
    this.nativeAbort?.abort();
    this.nativeAbort = controller;
    try {
      const result = await execFileAsync(executable, args, {
        encoding: "utf8",
        windowsHide: true,
        timeout,
        maxBuffer: 1_200_000,
        signal: controller.signal,
        env: {
          ...process.env,
          WINAPP_CLI_TELEMETRY_OPTOUT: "1",
          DOTNET_CLI_TELEMETRY_OPTOUT: "1",
          DOTNET_NOLOGO: "1",
        },
      });
      return String(result.stdout || "").trim();
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error("Computer Control was stopped");
      throw new Error(limitedNativeError(error));
    } finally {
      if (this.nativeAbort === controller) this.nativeAbort = null;
    }
  }

  private nativeArgs(
    action: "list" | "inspect" | "invoke" | "click" | "set-value" | "type",
    target = "",
    query = "",
    text = "",
  ) {
    if (process.platform === "darwin") return [action, target, query, text];
    if (action === "list") return ["ui", "list-windows", "--json"];
    if (action === "inspect")
      return [
        "ui",
        "inspect",
        ...(query ? [query] : []),
        "--app",
        target,
        "--interactive",
        "--hide-disabled",
        "--hide-offscreen",
        "--depth",
        "8",
        "--json",
      ];
    if (action === "invoke" || action === "click")
      return ["ui", action, query, "--app", target, "--json"];
    if (action === "set-value")
      return ["ui", "set-value", query, text, "--app", target, "--json"];
    return [
      "ui",
      "send-keys",
      text,
      "--app",
      target,
      "--target",
      query,
      "--verbatim",
      "--via",
      "send-input",
      "--json",
    ];
  }

  private sanitizedApplicationList(output: string) {
    const parsed = parseNativeJson(output);
    if (!Array.isArray(parsed)) return JSON.stringify(parsed);
    return JSON.stringify(
      parsed.filter(
        (entry) => !blockedNativeTarget.test(JSON.stringify(entry)),
      ),
    );
  }

  private async showNativeCursor(point: { x: number; y: number } | null) {
    if (!point) return;
    let overlay = this.cursorOverlay;
    if (!overlay || overlay.isDestroyed()) {
      overlay = new BrowserWindow({
        width: 34,
        height: 34,
        x: point.x - 17,
        y: point.y - 17,
        show: false,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        closable: false,
        focusable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          devTools: false,
        },
      });
      overlay.setIgnoreMouseEvents(true, { forward: true });
      overlay.setAlwaysOnTop(true, "screen-saver");
      if (process.platform === "darwin")
        overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      await overlay.loadURL(
        `data:text/html,${encodeURIComponent(
          '<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}.cursor{width:21px;height:27px;margin:2px 0 0 4px;clip-path:polygon(0 0,0 82%,22% 64%,36% 100%,50% 94%,36% 60%,65% 60%);background:#89cff0;filter:drop-shadow(0 0 2px #07131a) drop-shadow(0 0 5px rgba(137,207,240,.85))}</style><div class="cursor"></div>',
        )}`,
      );
      this.cursorOverlay = overlay;
    }
    overlay.setBounds({
      x: Math.round(point.x - 17),
      y: Math.round(point.y - 17),
      width: 34,
      height: 34,
    });
    overlay.showInactive();
  }

  private closeNativeCursor() {
    const overlay = this.cursorOverlay;
    this.cursorOverlay = null;
    if (overlay && !overlay.isDestroyed()) overlay.destroy();
  }

  private emitComputer(
    target: string,
    mode: "oscode" | "background" | "foreground",
    verb: string,
  ) {
    const modeLabel =
      mode === "foreground"
        ? "foreground pointer"
        : mode === "background"
          ? "accessibility"
          : "editor";
    this.emit({
      kind: "computer",
      label: `Computer Control · ${target} · ${verb} · ${modeLabel} · Esc to stop`,
      active: true,
      network: false,
      target,
      mode,
    });
  }

  private createBrowser() {
    if (this.browser && !this.browser.isDestroyed()) return this.browser;
    const partition = `oscode-agent-browser-${process.pid}`;
    this.browserSession = session.fromPartition(partition, { cache: false });
    this.browserSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    this.browserSession.setDevicePermissionHandler(() => false);
    this.browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({
        requestHeaders: {
          ...strippedReceiveOnlyHeaders(details.requestHeaders),
          DNT: "1",
        },
      });
    });
    this.browserSession.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...(details.responseHeaders || {}) };
      for (const name of Object.keys(responseHeaders)) {
        if (["set-cookie", "set-cookie2"].includes(name.toLowerCase()))
          delete responseHeaders[name];
      }
      callback({ responseHeaders });
    });
    this.browserSession.webRequest.onBeforeRequest((details, callback) => {
      const policy = receiveOnlyBrowserRequest(details);
      if (!policy.allowed) {
        this.blockedOutbound(policy.reason, details.url);
        callback({ cancel: true });
        return;
      }
      void validatedAddress(details.url, this.projectRoot())
        .then((target) => {
          const source = details.referrer || "";
          const publicPage = source.startsWith("https:");
          const localTarget =
            target.url.startsWith("file:") || target.url.startsWith("http:");
          callback({ cancel: publicPage && localTarget });
        })
        .catch(() => callback({ cancel: true }));
    });
    const window = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: "osCode · Agent browser",
      backgroundColor: "#111719",
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false,
        devTools: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("before-input-event", (event, input) => {
      if (input.key === "Escape") {
        event.preventDefault();
        void this.stop();
      }
    });
    window.webContents.on("did-start-loading", () => {
      const url = window.webContents.getURL();
      this.emit({
        kind: "browser",
        label: "Agent browser is loading",
        active: true,
        network: url.startsWith("https:"),
        url,
      });
    });
    window.webContents.on("did-finish-load", () => {
      const url = window.webContents.getURL();
      let label = "Agent browser is open";
      try {
        label = `Agent browser · ${new URL(url).hostname || "project preview"}`;
      } catch {}
      this.emit({
        kind: "browser",
        label,
        active: true,
        network: url.startsWith("https:"),
        url,
      });
    });
    window.on("closed", () => {
      this.browser = null;
      this.emit({
        kind: "browser",
        label: "Agent browser stopped",
        active: false,
        network: false,
      });
    });
    this.browser = window;
    return window;
  }

  async openBrowser(rawUrl: string) {
    const root = this.projectRoot();
    if (!root) throw new Error("Open a project first");
    const target = await validatedAddress(rawUrl, root);
    const window = this.createBrowser();
    await window.loadURL(target.url);
    if (this.visible) {
      window.show();
      window.focus();
    }
    this.emit({
      kind: "browser",
      label: target.network
        ? `Agent browser online · ${new URL(target.url).hostname}`
        : "Agent browser · local preview",
      active: true,
      network: target.network,
      url: target.url,
    });
    return `Opened ${target.url} in the dedicated agent browser`;
  }

  async inspectBrowser() {
    const window = this.browser;
    if (!window || window.isDestroyed())
      throw new Error("Open the agent browser first");
    return execute(window.webContents, inspectScript);
  }

  async listWebMcpTools() {
    const window = this.browser;
    if (!window || window.isDestroyed())
      throw new Error("Open the agent browser first");
    return execute(window.webContents, webMcpToolsScript);
  }

  async callWebMcpTool(name: string, argumentsValue: unknown) {
    const window = this.browser;
    if (!window || window.isDestroyed())
      throw new Error("Open the agent browser first");
    const result = await execute(
      window.webContents,
      webMcpCallScript(name, argumentsValue),
    );
    this.emit({
      kind: "browser",
      label: `WebMCP · ${name}`,
      active: true,
      network: window.webContents.getURL().startsWith("https:"),
      url: window.webContents.getURL(),
    });
    return result;
  }

  async browserSnapshot() {
    const window = this.browser;
    if (!window || window.isDestroyed()) return null;
    const image = await window.webContents.capturePage();
    const size = image.getSize();
    const preview =
      size.width > 1440
        ? image.resize({ width: 1440, quality: "good" })
        : image;
    return {
      url: window.webContents.getURL(),
      title: window.webContents.getTitle() || "Agent browser",
      imageDataUrl: preview.toDataURL(),
      loading: window.webContents.isLoading(),
      capturedAt: Date.now(),
    };
  }

  async showBrowser() {
    const window = this.browser;
    if (!window || window.isDestroyed()) return null;
    window.show();
    window.focus();
    return this.browserSnapshot();
  }

  async clickBrowser(query: string) {
    const window = this.browser;
    if (!window || window.isDestroyed())
      throw new Error("Open the agent browser first");
    if (window.webContents.getURL().startsWith("https:")) {
      this.blockedOutbound(
        "Public pages are read-only; page controls cannot be clicked",
        window.webContents.getURL(),
      );
      throw new Error(
        "Public pages are read-only. Open a specific public page address instead.",
      );
    }
    const result = await execute(
      window.webContents,
      targetScript(query, "click"),
    );
    this.emit({
      kind: "browser",
      label: "Agent browser interaction",
      active: true,
      network: window.webContents.getURL().startsWith("https:"),
      url: window.webContents.getURL(),
    });
    return result;
  }

  async typeBrowser(query: string, text: string) {
    const window = this.browser;
    if (!window || window.isDestroyed())
      throw new Error("Open the agent browser first");
    if (window.webContents.getURL().startsWith("https:")) {
      this.blockedOutbound(
        "Typing into public pages is blocked",
        window.webContents.getURL(),
      );
      throw new Error(
        "Typing into public pages is blocked so local data cannot be submitted.",
      );
    }
    const result = await execute(
      window.webContents,
      targetScript(query, "type", text),
    );
    this.emit({
      kind: "browser",
      label: "Agent browser interaction",
      active: true,
      network: window.webContents.getURL().startsWith("https:"),
      url: window.webContents.getURL(),
    });
    return result;
  }

  async closeBrowser() {
    const window = this.browser;
    this.browser = null;
    if (window && !window.isDestroyed()) window.close();
    if (this.browserSession)
      await this.browserSession.clearStorageData().catch(() => undefined);
    this.browserSession = null;
    this.emit({
      kind: "browser",
      label: "Agent browser closed",
      active: false,
      network: false,
    });
    return "The dedicated agent browser is closed";
  }

  async listComputerTargets() {
    this.activeComputer = true;
    this.emitComputer("visible apps", "background", "inspecting");
    const output = await this.nativeOutput(this.nativeArgs("list"));
    return JSON.stringify({
      osCode: {
        target: "osCode",
        note: "Use this target for the editor itself",
      },
      applications: parseNativeJson(this.sanitizedApplicationList(output)),
    });
  }

  async inspectComputer(target?: string) {
    if (!osCodeTarget(target)) {
      const nativeTarget = cleanNativeTarget(target || "");
      this.activeComputer = true;
      this.emitComputer(nativeTarget, "background", "inspecting");
      const output = await this.nativeOutput(
        this.nativeArgs("inspect", nativeTarget),
      );
      return JSON.stringify(parseNativeJson(output));
    }
    const window = this.main();
    if (!window || window.isDestroyed())
      throw new Error("The osCode window is unavailable");
    this.activeComputer = true;
    this.emitComputer("osCode", "oscode", "inspecting");
    return execute(window.webContents, inspectScript);
  }

  async clickComputer(query: string, target?: string) {
    if (!osCodeTarget(target)) {
      const nativeTarget = cleanNativeTarget(target || "");
      const selector = query
        .replace(/[\r\n\0]/g, "")
        .trim()
        .slice(0, 300);
      if (!selector) throw new Error("Describe the control to use");
      this.activeComputer = true;
      const inspection = await this.nativeOutput(
        this.nativeArgs("inspect", nativeTarget, selector),
      ).catch(() => "");
      await this.showNativeCursor(nativePoint(parseNativeJson(inspection)));
      let output: string;
      let mode: "background" | "foreground" = "background";
      try {
        output = await this.nativeOutput(
          this.nativeArgs("invoke", nativeTarget, selector),
        );
      } catch (invokeError) {
        if (process.platform !== "win32") throw invokeError;
        mode = "foreground";
        output = await this.nativeOutput(
          this.nativeArgs("click", nativeTarget, selector),
        );
      }
      this.emitComputer(nativeTarget, mode, "acting");
      return JSON.stringify({ mode, result: parseNativeJson(output) });
    }
    const window = this.main();
    if (!window || window.isDestroyed())
      throw new Error("The osCode window is unavailable");
    this.activeComputer = true;
    const result = await execute(
      window.webContents,
      targetScript(query, "click"),
    );
    this.emitComputer("osCode", "oscode", "acting");
    return result;
  }

  async typeComputer(query: string, text: string, target?: string) {
    if (!osCodeTarget(target)) {
      const nativeTarget = cleanNativeTarget(target || "");
      const selector = query
        .replace(/[\r\n\0]/g, "")
        .trim()
        .slice(0, 300);
      const nextText = text.replace(/\0/g, "").slice(0, 20_000);
      if (!selector) throw new Error("Describe the field to use");
      this.activeComputer = true;
      const inspection = await this.nativeOutput(
        this.nativeArgs("inspect", nativeTarget, selector),
      ).catch(() => "");
      await this.showNativeCursor(nativePoint(parseNativeJson(inspection)));
      let output: string;
      let mode: "background" | "foreground" = "background";
      try {
        output = await this.nativeOutput(
          this.nativeArgs("set-value", nativeTarget, selector, nextText),
        );
      } catch (setValueError) {
        if (process.platform !== "win32") throw setValueError;
        mode = "foreground";
        output = await this.nativeOutput(
          this.nativeArgs("type", nativeTarget, selector, nextText),
        );
      }
      this.emitComputer(nativeTarget, mode, "typing");
      return JSON.stringify({ mode, result: parseNativeJson(output) });
    }
    const window = this.main();
    if (!window || window.isDestroyed())
      throw new Error("The osCode window is unavailable");
    this.activeComputer = true;
    const result = await execute(
      window.webContents,
      targetScript(query, "type", text),
    );
    this.emitComputer("osCode", "oscode", "typing");
    return result;
  }

  isActive() {
    return (
      this.activeComputer ||
      Boolean(this.browser && !this.browser.isDestroyed())
    );
  }

  async stop() {
    this.activeComputer = false;
    this.nativeAbort?.abort();
    this.nativeAbort = null;
    this.closeNativeCursor();
    await this.closeBrowser();
    const main = this.main();
    if (main && !main.isDestroyed())
      await main.webContents
        .executeJavaScript(
          "document.getElementById('oscode-agent-cursor')?.remove()",
          true,
        )
        .catch(() => undefined);
    this.emit({
      kind: "computer",
      label: "Agent control stopped",
      active: false,
      network: false,
    });
    return true;
  }
}
