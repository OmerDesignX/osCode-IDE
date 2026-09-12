export type PersistedShellTab = {
  id: string;
  title: string;
  restart: number;
};

export type PersistedTerminalWorkspace = {
  tabs: PersistedShellTab[];
  activeId: string;
  open: boolean;
  view: "shell" | "python";
};

const workspacePrefix = "oscode:terminal-workspace:v1:";
const transcriptPrefix = "oscode:terminal-transcript:v1:";
const maximumTabs = 8;
const maximumTranscriptLength = 512 * 1024;

const storage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

const scopedKey = (prefix: string, projectRoot: string, id = "") =>
  `${prefix}${encodeURIComponent(projectRoot)}${id ? `:${encodeURIComponent(id)}` : ""}`;

export function validPersistedShellTabs(value: unknown): PersistedShellTab[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  const result: PersistedShellTab[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<PersistedShellTab>;
    if (
      typeof candidate.id !== "string" ||
      !/^shell-[a-zA-Z0-9-]{1,96}$/.test(candidate.id) ||
      unique.has(candidate.id) ||
      typeof candidate.title !== "string"
    )
      continue;
    unique.add(candidate.id);
    result.push({
      id: candidate.id,
      title:
        candidate.title.trim().slice(0, 48) || `Shell ${result.length + 1}`,
      restart:
        Number.isInteger(candidate.restart) && Number(candidate.restart) >= 0
          ? Math.min(Number(candidate.restart), 10_000)
          : 0,
    });
    if (result.length >= maximumTabs) break;
  }
  return result;
}

export function loadTerminalWorkspace(
  projectRoot: string,
): PersistedTerminalWorkspace | null {
  if (!projectRoot) return null;
  try {
    const raw = storage()?.getItem(scopedKey(workspacePrefix, projectRoot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedTerminalWorkspace>;
    const tabs = validPersistedShellTabs(parsed.tabs);
    if (!tabs.length) return null;
    return {
      tabs,
      activeId:
        typeof parsed.activeId === "string" &&
        tabs.some((tab) => tab.id === parsed.activeId)
          ? parsed.activeId
          : tabs[0].id,
      open: parsed.open === true,
      view: parsed.view === "python" ? "python" : "shell",
    };
  } catch {
    return null;
  }
}

export function saveTerminalWorkspace(
  projectRoot: string,
  workspace: PersistedTerminalWorkspace,
) {
  if (!projectRoot) return;
  const tabs = validPersistedShellTabs(workspace.tabs);
  try {
    if (!tabs.length) {
      storage()?.removeItem(scopedKey(workspacePrefix, projectRoot));
      return;
    }
    storage()?.setItem(
      scopedKey(workspacePrefix, projectRoot),
      JSON.stringify({
        tabs,
        activeId: tabs.some((tab) => tab.id === workspace.activeId)
          ? workspace.activeId
          : tabs[0].id,
        open: workspace.open,
        view: workspace.view === "python" ? "python" : "shell",
      }),
    );
  } catch {
    // Terminal restoration is best-effort when browser storage is unavailable.
  }
}

export function terminalProcessId(tab: PersistedShellTab) {
  return `${tab.id}-${tab.restart}`;
}

export function trimTerminalTranscript(value: string) {
  return value.length <= maximumTranscriptLength
    ? value
    : value.slice(-maximumTranscriptLength);
}

export function readTerminalTranscript(projectRoot: string, id: string) {
  if (!projectRoot || !id) return "";
  try {
    return trimTerminalTranscript(
      storage()?.getItem(scopedKey(transcriptPrefix, projectRoot, id)) || "",
    );
  } catch {
    return "";
  }
}

export function saveTerminalTranscript(
  projectRoot: string,
  id: string,
  transcript: string,
) {
  if (!projectRoot || !id) return;
  try {
    storage()?.setItem(
      scopedKey(transcriptPrefix, projectRoot, id),
      trimTerminalTranscript(transcript),
    );
  } catch {
    // A full storage quota must not interrupt a running terminal.
  }
}

export function removeTerminalTranscript(projectRoot: string, id: string) {
  if (!projectRoot || !id) return;
  try {
    storage()?.removeItem(scopedKey(transcriptPrefix, projectRoot, id));
  } catch {
    // Best-effort cleanup only.
  }
}
