import fs from "node:fs/promises";
import path from "node:path";

export type ProjectTransferMode = "copy" | "move";

export type ProjectFileOperationResult = {
  sourcePath: string;
  newPath: string;
  name: string;
  kind: "file" | "directory";
};

export function validateProjectItemName(input: unknown) {
  if (typeof input !== "string")
    throw new Error("The project item name is invalid");
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

function assertInside(root: string, target: string) {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Path is outside the project");
}

async function resolveRoot(rootPath: string) {
  if (!rootPath) throw new Error("Open a project first");
  return fs.realpath(rootPath);
}

async function resolveExisting(root: string, targetPath: string) {
  const target = await fs.realpath(targetPath);
  assertInside(root, target);
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink())
    throw new Error("Linked project items cannot be changed here");
  return { target, stat };
}

function splitName(name: string, directory: boolean) {
  if (directory) return { stem: name, extension: "" };
  const extension = path.extname(name);
  return {
    stem: extension ? name.slice(0, -extension.length) : name,
    extension,
  };
}

async function availableCopyPath(
  parent: string,
  name: string,
  directory: boolean,
) {
  const { stem, extension } = splitName(name, directory);
  for (let index = 1; index <= 10_000; index += 1) {
    const suffix = index === 1 ? " copy" : ` copy ${index}`;
    const candidate = path.join(parent, `${stem}${suffix}${extension}`);
    if (!(await fs.lstat(candidate).catch(() => null))) return candidate;
  }
  throw new Error("A unique duplicate name could not be created");
}

export async function duplicateProjectEntry(
  rootPath: string,
  sourcePath: string,
  content?: string,
): Promise<ProjectFileOperationResult> {
  const root = await resolveRoot(rootPath);
  const { target: source, stat } = await resolveExisting(root, sourcePath);
  if (source === root) throw new Error("The project root cannot be duplicated");
  if (!stat.isFile() && !stat.isDirectory())
    throw new Error("Only regular project files and folders can be duplicated");
  const destination = await availableCopyPath(
    path.dirname(source),
    path.basename(source),
    stat.isDirectory(),
  );
  assertInside(root, destination);
  if (stat.isDirectory())
    await fs.cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  else if (typeof content === "string")
    await fs.writeFile(destination, content, "utf8");
  else await fs.copyFile(source, destination);
  return {
    sourcePath: source,
    newPath: destination,
    name: path.basename(destination),
    kind: stat.isDirectory() ? "directory" : "file",
  };
}

export async function transferProjectEntry(
  rootPath: string,
  sourcePath: string,
  destinationDirectoryPath: string,
  mode: ProjectTransferMode,
): Promise<ProjectFileOperationResult> {
  const root = await resolveRoot(rootPath);
  const [{ target: source, stat }, destinationDirectory] = await Promise.all([
    resolveExisting(root, sourcePath),
    fs.realpath(destinationDirectoryPath),
  ]);
  assertInside(root, destinationDirectory);
  const destinationStat = await fs.lstat(destinationDirectory);
  if (!destinationStat.isDirectory() || destinationStat.isSymbolicLink())
    throw new Error("Choose a regular project folder");
  if (source === root)
    throw new Error("The project root cannot be moved or copied");
  if (!stat.isFile() && !stat.isDirectory())
    throw new Error(
      "Only regular project files and folders can be moved or copied",
    );
  if (
    stat.isDirectory() &&
    (destinationDirectory === source ||
      path.relative(source, destinationDirectory).split(path.sep)[0] !== "..")
  )
    throw new Error("A folder cannot be placed inside itself");
  let destination = path.join(destinationDirectory, path.basename(source));
  if (destination === source)
    destination = await availableCopyPath(
      destinationDirectory,
      path.basename(source),
      stat.isDirectory(),
    );
  else if (await fs.lstat(destination).catch(() => null)) {
    if (mode === "move")
      throw new Error("An item with that name already exists in that folder");
    destination = await availableCopyPath(
      destinationDirectory,
      path.basename(source),
      stat.isDirectory(),
    );
  }
  assertInside(root, destination);
  if (mode === "move") await fs.rename(source, destination);
  else if (stat.isDirectory())
    await fs.cp(source, destination, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  else await fs.copyFile(source, destination);
  return {
    sourcePath: source,
    newPath: destination,
    name: path.basename(destination),
    kind: stat.isDirectory() ? "directory" : "file",
  };
}
