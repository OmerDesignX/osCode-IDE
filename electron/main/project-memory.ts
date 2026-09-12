import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SecureDataStore } from "./secure-store.js";

const schemaVersion = 1;
const sourceExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".kt",
  ".md",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
]);

export type ProjectFileMemory = {
  path: string;
  size: number;
  mtimeMs: number;
  language: string;
  symbols: string[];
  imports: string[];
};

export type ProjectMemoryAction = {
  at: string;
  tool: string;
  status: "completed" | "failed";
  detail: string;
  files: string[];
};

export type ProjectMemory = {
  schema: number;
  projectName: string;
  refreshedAt: string;
  files: ProjectFileMemory[];
  actions: ProjectMemoryAction[];
};

function projectKey(root: string) {
  return crypto
    .createHash("sha256")
    .update(path.resolve(root).toLowerCase())
    .digest("hex");
}

function languageFor(file: string) {
  const extension = path.extname(file).toLowerCase();
  return (
    (
      {
        ".c": "C",
        ".cc": "C++",
        ".cpp": "C++",
        ".cs": "C#",
        ".css": "CSS",
        ".go": "Go",
        ".h": "C/C++ header",
        ".hpp": "C++ header",
        ".html": "HTML",
        ".java": "Java",
        ".js": "JavaScript",
        ".jsx": "JavaScript JSX",
        ".json": "JSON",
        ".kt": "Kotlin",
        ".md": "Markdown",
        ".php": "PHP",
        ".py": "Python",
        ".rb": "Ruby",
        ".rs": "Rust",
        ".sh": "Shell",
        ".sql": "SQL",
        ".swift": "Swift",
        ".toml": "TOML",
        ".ts": "TypeScript",
        ".tsx": "TypeScript JSX",
        ".vue": "Vue",
        ".xml": "XML",
        ".yaml": "YAML",
        ".yml": "YAML",
      } as Record<string, string>
    )[extension] || (extension ? extension.slice(1).toUpperCase() : "text")
  );
}

function unique(values: string[], limit: number) {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, limit);
}

export function summarizeProjectFile(
  relativePath: string,
  content: string,
  size: number,
  mtimeMs: number,
): ProjectFileMemory {
  const imports: string[] = [];
  const symbols: string[] = [];
  const lines = content.slice(0, 180_000).split(/\r?\n/);
  for (const line of lines) {
    if (imports.length < 24) {
      const imported =
        /^\s*import\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/.exec(line)?.[1] ||
        /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/
          .exec(line)
          ?.slice(1)
          .find(Boolean) ||
        /^\s*#include\s*[<"]([^>"]+)[>"]/.exec(line)?.[1] ||
        /^\s*use\s+([^;]+);/.exec(line)?.[1] ||
        /\brequire\(\s*["']([^"']+)["']\s*\)/.exec(line)?.[1];
      if (imported) imports.push(imported);
    }
    if (symbols.length < 36) {
      const symbol =
        /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:class|interface|type|enum|function|def|struct|trait|protocol)\s+([A-Za-z_$][\w$]*)/.exec(
          line,
        )?.[1] ||
        /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/.exec(
          line,
        )?.[1] ||
        /^\s*(?:public|private|protected|internal|static|final|async|virtual|override|inline|constexpr|extern|unsigned|signed|long|short|void|int|char|float|double|bool|string|auto|[A-Z][\w:<>]*)[\w\s:*&<>?,\[\]]*\s+([A-Za-z_$][\w$]*)\s*\(/.exec(
          line,
        )?.[1];
      if (symbol) symbols.push(symbol);
    }
  }
  return {
    path: relativePath.replace(/\\/g, "/"),
    size,
    mtimeMs,
    language: languageFor(relativePath),
    symbols: unique(symbols, 36),
    imports: unique(imports, 24),
  };
}

function queryTerms(value: string) {
  return unique(
    value
      .toLowerCase()
      .replace(/[^a-z0-9_./-]+/g, " ")
      .split(/\s+/)
      .filter((term) => term.length >= 2),
    80,
  );
}

export function rankProjectMemoryFiles(
  memory: ProjectMemory,
  request: string,
  activeFile = "",
  limit = 12,
) {
  const terms = queryTerms(request);
  const normalizedActive = activeFile.replace(/\\/g, "/").toLowerCase();
  return memory.files
    .map((file) => {
      const normalizedPath = file.path.toLowerCase();
      const basename = path.basename(normalizedPath);
      const searchable = [
        normalizedPath,
        file.language.toLowerCase(),
        ...file.symbols.map((value) => value.toLowerCase()),
        ...file.imports.map((value) => value.toLowerCase()),
      ].join(" ");
      let score = normalizedActive === normalizedPath ? 10_000 : 0;
      for (const term of terms) {
        if (basename === term || basename.startsWith(`${term}.`)) score += 30;
        else if (basename.includes(term)) score += 12;
        if (normalizedPath.includes(term)) score += 7;
        if (file.symbols.some((symbol) => symbol.toLowerCase() === term))
          score += 18;
        else if (searchable.includes(term)) score += 3;
      }
      return { ...file, score };
    })
    .filter((file) => file.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path),
    )
    .slice(0, Math.max(1, limit));
}

export function projectMemoryPrompt(
  memory: ProjectMemory,
  request: string,
  activeFile = "",
) {
  const relevant = rankProjectMemoryFiles(memory, request, activeFile);
  const lines = [
    `<oscode_project_memory files="${memory.files.length}" refreshed="${memory.refreshedAt}">`,
    "This encrypted local index contains metadata only. Read exact file contents before editing.",
  ];
  for (const file of relevant) {
    lines.push(
      [
        file.path,
        file.language,
        file.symbols.length ? `symbols=${file.symbols.join(",")}` : "",
        file.imports.length ? `imports=${file.imports.join(",")}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    );
  }
  if (memory.actions.length) {
    lines.push("Recent project evidence:");
    for (const action of memory.actions.slice(0, 8))
      lines.push(
        `${action.status} · ${action.tool} · ${action.detail}${action.files.length ? ` · ${action.files.join(", ")}` : ""}`,
      );
  }
  lines.push("</oscode_project_memory>");
  return lines.join("\n").slice(0, 24_000);
}

export class ProjectMemoryStore {
  private readonly cache = new Map<string, ProjectMemory>();
  private mutation = Promise.resolve();

  constructor(
    private readonly userData: string,
    private readonly secure = new SecureDataStore(userData),
  ) {}

  private memoryPath(root: string) {
    return path.join(
      this.secure.root,
      "projects",
      projectKey(root),
      "project-memory.oscode-data",
    );
  }

  private namespace(root: string) {
    return `project-memory:${projectKey(root)}:${schemaVersion}`;
  }

  private async load(root: string) {
    const key = projectKey(root);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const fallback: ProjectMemory = {
      schema: schemaVersion,
      projectName: path.basename(root),
      refreshedAt: "",
      files: [],
      actions: [],
    };
    const stored = await this.secure
      .readJson<ProjectMemory>(
        this.memoryPath(root),
        fallback,
        this.namespace(root),
      )
      .catch(() => fallback);
    const memory =
      stored?.schema === schemaVersion && Array.isArray(stored.files)
        ? {
            ...fallback,
            ...stored,
            files: stored.files.slice(0, 1_200),
            actions: Array.isArray(stored.actions)
              ? stored.actions.slice(0, 80)
              : [],
          }
        : fallback;
    this.cache.set(key, memory);
    return memory;
  }

  async refresh(rootInput: string, files: string[]) {
    const root = await fs.realpath(rootInput);
    const previous = await this.load(root);
    const priorFiles = new Map(previous.files.map((file) => [file.path, file]));
    const selected = files.slice(0, 1_200);
    const nextFiles: ProjectFileMemory[] = [];
    for (let offset = 0; offset < selected.length; offset += 32) {
      const batch = await Promise.all(
        selected.slice(offset, offset + 32).map(async (relativePath) => {
          const normalized = relativePath.replace(/\\/g, "/");
          const target = path.resolve(root, normalized);
          const relative = path.relative(root, target);
          if (relative.startsWith("..") || path.isAbsolute(relative))
            return null;
          const stat = await fs.stat(target).catch(() => null);
          if (!stat?.isFile()) return null;
          const prior = priorFiles.get(normalized);
          if (
            prior &&
            prior.size === stat.size &&
            Math.floor(prior.mtimeMs) === Math.floor(stat.mtimeMs)
          )
            return prior;
          const extension = path.extname(normalized).toLowerCase();
          const content =
            sourceExtensions.has(extension) && stat.size <= 350_000
              ? await fs.readFile(target, "utf8").catch(() => "")
              : "";
          return summarizeProjectFile(
            normalized,
            content,
            stat.size,
            stat.mtimeMs,
          );
        }),
      );
      nextFiles.push(
        ...batch.filter((file): file is ProjectFileMemory => Boolean(file)),
      );
    }
    nextFiles.sort((left, right) => left.path.localeCompare(right.path));
    const changed =
      nextFiles.length !== previous.files.length ||
      nextFiles.some((file, index) => {
        const prior = previous.files[index];
        return (
          !prior ||
          prior.path !== file.path ||
          prior.size !== file.size ||
          Math.floor(prior.mtimeMs) !== Math.floor(file.mtimeMs)
        );
      });
    const memory: ProjectMemory = {
      ...previous,
      projectName: path.basename(root),
      refreshedAt: changed
        ? new Date().toISOString()
        : previous.refreshedAt || new Date().toISOString(),
      files: nextFiles,
    };
    this.cache.set(projectKey(root), memory);
    if (changed || !previous.refreshedAt)
      await this.secure.writeJson(
        this.memoryPath(root),
        memory,
        this.namespace(root),
      );
    return memory;
  }

  async remember(rootInput: string, action: Omit<ProjectMemoryAction, "at">) {
    const root = await fs.realpath(rootInput);
    const operation = this.mutation.then(async () => {
      const memory = await this.load(root);
      const next: ProjectMemory = {
        ...memory,
        actions: [
          { ...action, at: new Date().toISOString() },
          ...memory.actions,
        ].slice(0, 80),
      };
      this.cache.set(projectKey(root), next);
      await this.secure.writeJson(
        this.memoryPath(root),
        next,
        this.namespace(root),
      );
    });
    this.mutation = operation.catch(() => undefined);
    await operation;
  }

  async flush() {
    await this.mutation;
  }
}
