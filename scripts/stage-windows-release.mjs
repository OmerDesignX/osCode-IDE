import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const releaseRoot = path.resolve(
  process.env.OSCODE_PACKAGE_DIR || path.join(root, "release"),
);
const outputRoot = path.join(root, "release-assets", "windows");
const installerSourceName = `osCode Setup ${packageJson.version}.exe`;
const installerName = `osCode-Setup-${packageJson.version}.exe`;
const blockmapName = `${installerName}.blockmap`;
const blockmapSourceName = `${installerSourceName}.blockmap`;
const updateMetadataName = "latest.yml";

const hashFile = async (file) => {
  const handle = await open(file, "r");
  const hash = createHash("sha256");
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
};

const copyVerified = async (source, destination, minimumBytes) => {
  const sourceStats = await stat(source);
  if (sourceStats.size < minimumBytes)
    throw new Error(`${path.basename(source)} is unexpectedly small`);
  await copyFile(source, destination);
  const destinationStats = await stat(destination);
  if (destinationStats.size !== sourceStats.size)
    throw new Error(`${path.basename(source)} was not copied completely`);
  return destinationStats.size;
};

await mkdir(outputRoot, { recursive: true });
const generatedReleaseName = (name) =>
  name === "latest.yml" ||
  name === "SHA256SUMS.txt" ||
  name === "manifest.json" ||
  /^osCode Setup .+\.exe(?:\.blockmap)?$/u.test(name) ||
  /^osCode-Setup-.+\.exe(?:\.blockmap)?$/u.test(name) ||
  /^osCode-windows-(?:SHA256SUMS\.txt|manifest\.json)$/u.test(name);

for (const entry of await readdir(outputRoot, { withFileTypes: true })) {
  const target = path.resolve(outputRoot, entry.name);
  if (path.dirname(target) !== outputRoot)
    throw new Error(`Refusing to clean an unexpected release path: ${target}`);
  if (entry.name === "models") {
    const targetStats = await lstat(target);
    if (targetStats.isSymbolicLink())
      throw new Error("Refusing to remove a linked release models directory");
    if (targetStats.isDirectory())
      await rm(target, { recursive: true, force: true });
    continue;
  }
  if (!generatedReleaseName(entry.name)) continue;
  const targetStats = await lstat(target);
  if (!targetStats.isFile())
    throw new Error(`Refusing to replace non-file release output: ${target}`);
  await rm(target, { force: true });
}
const staged = [];
const installerSource = path.join(releaseRoot, installerSourceName);
const installerTarget = path.join(outputRoot, installerName);
staged.push({
  name: installerName,
  path: installerTarget,
  bytes: await copyVerified(installerSource, installerTarget, 100_000_000),
});
const updateMetadataTarget = path.join(outputRoot, updateMetadataName);
staged.push({
  name: updateMetadataName,
  path: updateMetadataTarget,
  bytes: await copyVerified(
    path.join(releaseRoot, updateMetadataName),
    updateMetadataTarget,
    50,
  ),
});
const blockmapTarget = path.join(outputRoot, blockmapName);
staged.push({
  name: blockmapName,
  path: blockmapTarget,
  bytes: await copyVerified(
    path.join(releaseRoot, blockmapSourceName),
    blockmapTarget,
    10_000,
  ),
});

for (const item of staged) item.sha256 = await hashFile(item.path);
const checksumText = staged
  .map((item) => `${item.sha256}  ${item.name}`)
  .join("\n");
await writeFile(
  path.join(outputRoot, "osCode-windows-SHA256SUMS.txt"),
  `${checksumText}\n`,
);
await writeFile(
  path.join(outputRoot, "osCode-windows-manifest.json"),
  `${JSON.stringify(
    {
      version: packageJson.version,
      generatedAt: new Date().toISOString(),
      files: staged.map(({ path: _path, ...item }) => item),
    },
    null,
    2,
  )}\n`,
);

console.log(`Staged the Windows installer in ${outputRoot}`);
