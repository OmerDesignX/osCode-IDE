import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const platform = process.argv[2];
if (!["macos", "linux"].includes(platform))
  throw new Error("Usage: node scripts/stage-native-release.mjs <macos|linux>");

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const releaseRoot = path.resolve(
  process.env.OSCODE_PACKAGE_DIR || path.join(root, "release"),
);
const outputRoot = path.join(root, "release-assets", platform);
const partBytes = 1_900_000_000;
const releaseNames = (await readdir(releaseRoot)).filter((name) =>
  platform === "macos"
    ? name.endsWith(".zip")
    : name.endsWith(".deb") || name.endsWith(".snap"),
);
const updateMetadataName =
  platform === "macos" ? "latest-mac.yml" : "latest-linux.yml";
if (releaseNames.length === 0)
  throw new Error(`No ${platform} packages were found in release`);

await mkdir(outputRoot, { recursive: true });
for (const name of await readdir(outputRoot)) {
  if (name !== "README.md")
    await rm(path.join(outputRoot, name), { recursive: true, force: true });
}

const copyParts = async (source, name) => {
  const sourceStats = await stat(source);
  const sourceHandle = await open(source, "r");
  const wholeHash = createHash("sha256");
  const parts = [];
  let offset = 0;
  let partNumber = 1;
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  try {
    while (offset < sourceStats.size) {
      const split = sourceStats.size > partBytes;
      const partName = split
        ? `${name}.part${String(partNumber).padStart(3, "0")}`
        : name;
      const destination = path.join(outputRoot, partName);
      const destinationHandle = await open(destination, "w");
      const partHash = createHash("sha256");
      const limit = Math.min(sourceStats.size, offset + partBytes);
      let partSize = 0;
      try {
        while (offset < limit) {
          const wanted = Math.min(buffer.length, limit - offset);
          const { bytesRead } = await sourceHandle.read(
            buffer,
            0,
            wanted,
            offset,
          );
          if (bytesRead === 0) throw new Error(`Unexpected end of ${name}`);
          const chunk = buffer.subarray(0, bytesRead);
          await destinationHandle.write(chunk, 0, bytesRead, partSize);
          wholeHash.update(chunk);
          partHash.update(chunk);
          offset += bytesRead;
          partSize += bytesRead;
        }
      } finally {
        await destinationHandle.close();
      }
      parts.push({
        name: partName,
        bytes: partSize,
        sha256: partHash.digest("hex"),
      });
      partNumber += 1;
    }
  } finally {
    await sourceHandle.close();
  }
  return {
    name,
    bytes: sourceStats.size,
    sha256: wholeHash.digest("hex"),
    parts,
  };
};

const artifacts = [];
for (const name of releaseNames.sort())
  artifacts.push(await copyParts(path.join(releaseRoot, name), name));

const updateMetadata = await readFile(
  path.join(releaseRoot, updateMetadataName),
);
await writeFile(path.join(outputRoot, updateMetadataName), updateMetadata);
const metadataFile = {
  name: updateMetadataName,
  bytes: updateMetadata.length,
  sha256: createHash("sha256").update(updateMetadata).digest("hex"),
};
const stagedParts = [
  ...artifacts.flatMap((artifact) => artifact.parts),
  metadataFile,
];
await writeFile(
  path.join(outputRoot, `osCode-${platform}-SHA256SUMS.txt`),
  `${stagedParts.map((part) => `${part.sha256}  ${part.name}`).join("\n")}\n`,
);
await writeFile(
  path.join(outputRoot, `osCode-${platform}-manifest.json`),
  `${JSON.stringify(
    {
      platform,
      version: packageJson.version,
      generatedAt: new Date().toISOString(),
      partBytes,
      artifacts,
      updateMetadata: metadataFile,
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Staged ${artifacts.length} ${platform} packages as ${stagedParts.length} release files`,
);
