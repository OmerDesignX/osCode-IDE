const fs = require("node:fs/promises");
const path = require("node:path");

const X64_ARCH = 1;
const ARM64_ARCH = 3;

async function makeTreeInstallable(root) {
  await fs.chmod(root, 0o755);
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await makeTreeInstallable(target);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = await fs.stat(target);
    await fs.chmod(target, stat.mode & 0o111 ? 0o755 : 0o644);
  }
}

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const architecture =
    context.arch === ARM64_ARCH
      ? "arm64"
      : context.arch === X64_ARCH
        ? "x64"
        : "";
  if (!architecture)
    throw new Error(`Unsupported macOS package architecture: ${context.arch}`);

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const pythonRoot = path.join(
    context.appOutDir,
    appName,
    "Contents",
    "Resources",
    "python",
    `darwin-${architecture}`,
  );

  // Runtime bytecode is redirected to app data. Keep the installed resources
  // owner-writable so Finder and the update installer can replace an existing
  // application bundle without reporting that Applications is locked.
  await makeTreeInstallable(pythonRoot);
  console.log(
    `Prepared the packaged ${architecture} Python runtime for replacement`,
  );
};
