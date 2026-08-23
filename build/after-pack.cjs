const fs = require("node:fs/promises");
const path = require("node:path");

const UNIVERSAL_ARCH = 4;

/**
 * Add architecture-specific macOS runtimes after electron-builder has merged
 * the x64 and arm64 app bundles. Copying them into each temporary app causes
 * @electron/universal to follow Python symlinks and reject otherwise identical
 * runtime trees.
 */
module.exports = async function afterPack(context) {
  if (
    context.electronPlatformName !== "darwin" ||
    context.arch !== UNIVERSAL_ARCH
  )
    return;

  const projectRoot = context.packager.projectDir;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const resourcesRoot = path.join(
    context.appOutDir,
    appName,
    "Contents",
    "Resources",
  );
  const resources = [
    ["vendor/uv/darwin-arm64", "uv/darwin-arm64"],
    ["vendor/uv/darwin-x64", "uv/darwin-x64"],
    ["vendor/python/darwin-arm64", "python/darwin-arm64"],
    ["vendor/python/darwin-x64", "python/darwin-x64"],
    ["vendor/llama/darwin-arm64", "llama/darwin-arm64"],
    ["vendor/llama/darwin-x64", "llama/darwin-x64"],
    ["vendor/llama/LICENSE", "llama/LICENSE"],
    [
      "vendor/computer-control/darwin-universal",
      "computer-control/darwin-universal",
    ],
  ];

  for (const [sourceRelative, destinationRelative] of resources) {
    const source = path.join(projectRoot, sourceRelative);
    const destination = path.join(resourcesRoot, destinationRelative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(source, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    });
  }

  console.log("Added both Monterey-compatible macOS runtime trees");
};
