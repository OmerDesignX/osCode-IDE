import path from "node:path";
import fs from "node:fs/promises";

export type PythonEnvironmentKind = "venv" | "conda";

export type ProjectPythonEnvironmentCandidate = {
  environment: string;
  interpreter: string;
  kind: PythonEnvironmentKind;
  name: string;
};

const COMMON_ENVIRONMENT_NAMES = [
  ".venv",
  "venv",
  "env",
  ".env",
  "virtualenv",
  ".virtualenv",
  ".conda",
  "conda-env",
];

const SKIPPED_SCAN_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  "__pycache__",
  "node_modules",
  "build",
  "coverage",
  "dist",
  "release",
  "vendor",
]);

function interpreterRelatives(platform: NodeJS.Platform) {
  return platform === "win32"
    ? ["Scripts/python.exe", "python.exe"]
    : ["bin/python", "bin/python3"];
}

async function environmentKind(
  environment: string,
): Promise<PythonEnvironmentKind | null> {
  if (
    (
      await fs.stat(path.join(environment, "conda-meta")).catch(() => null)
    )?.isDirectory()
  )
    return "conda";
  if (
    (
      await fs.stat(path.join(environment, "pyvenv.cfg")).catch(() => null)
    )?.isFile()
  )
    return "venv";
  return null;
}

async function candidateForEnvironment(
  root: string,
  environment: string,
  platform: NodeJS.Platform,
): Promise<ProjectPythonEnvironmentCandidate | null> {
  const kind = await environmentKind(environment);
  if (!kind) return null;
  for (const relative of interpreterRelatives(platform)) {
    const interpreter = path.join(environment, relative);
    if ((await fs.stat(interpreter).catch(() => null))?.isFile()) {
      const projectRelative = path
        .relative(root, environment)
        .replace(/\\/g, "/");
      return {
        environment,
        interpreter,
        kind,
        name: projectRelative || path.basename(root),
      };
    }
  }
  return null;
}

function candidateRank(candidate: ProjectPythonEnvironmentCandidate) {
  const normalized = candidate.name.toLowerCase();
  const common = COMMON_ENVIRONMENT_NAMES.indexOf(normalized);
  if (common >= 0) return common;
  if (normalized.startsWith(".oscode/envs/")) return 20;
  if (normalized.startsWith(".tox/") || normalized.startsWith(".nox/"))
    return 30;
  return 50;
}

export async function discoverProjectPythonEnvironments(
  project: string,
  platform: NodeJS.Platform = process.platform,
) {
  const root = await fs.realpath(project);
  const environments = new Set<string>();
  for (const name of COMMON_ENVIRONMENT_NAMES)
    environments.add(path.join(root, name));

  const visit = async (directory: string, depth: number): Promise<void> => {
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => []);
    if (
      entries.some(
        (entry) =>
          (entry.name === "pyvenv.cfg" && entry.isFile()) ||
          (entry.name === "conda-meta" && entry.isDirectory()),
      )
    )
      environments.add(directory);
    if (depth >= 3) return;
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.isSymbolicLink() &&
            !SKIPPED_SCAN_DIRECTORIES.has(entry.name),
        )
        .map((entry) => visit(path.join(directory, entry.name), depth + 1)),
    );
  };
  await visit(root, 0);

  const found = (
    await Promise.all(
      [...environments].map((environment) =>
        candidateForEnvironment(root, environment, platform),
      ),
    )
  ).filter(
    (candidate): candidate is ProjectPythonEnvironmentCandidate =>
      candidate !== null,
  );
  const unique = new Map<string, ProjectPythonEnvironmentCandidate>();
  for (const candidate of found) {
    const key =
      platform === "win32"
        ? candidate.interpreter.toLowerCase()
        : candidate.interpreter;
    if (!unique.has(key)) unique.set(key, candidate);
  }
  return [...unique.values()].sort(
    (left, right) =>
      candidateRank(left) - candidateRank(right) ||
      left.name.localeCompare(right.name),
  );
}

export async function pythonEnvironmentForInterpreter(
  interpreter: string,
  platform: NodeJS.Platform = process.platform,
) {
  const executable = path.resolve(interpreter);
  const parent = path.dirname(executable);
  const parentName = path.basename(parent).toLowerCase();
  const likelyEnvironment = ["bin", "scripts"].includes(parentName)
    ? path.dirname(parent)
    : platform === "win32" &&
        path.basename(executable).toLowerCase() === "python.exe"
      ? parent
      : "";
  if (!likelyEnvironment) return null;
  const environment = await fs.realpath(likelyEnvironment);
  const kind = await environmentKind(environment);
  return kind ? { environment, kind } : null;
}

export function parseCondaEnvironmentPrefixes(value: string) {
  try {
    const parsed = JSON.parse(value) as { envs?: unknown };
    if (!Array.isArray(parsed.envs)) return [];
    return parsed.envs.filter(
      (entry): entry is string =>
        typeof entry === "string" && path.isAbsolute(entry),
    );
  } catch {
    return [];
  }
}
