import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code}`)),
    );
  });
}

if (process.platform === "darwin") {
  const source = path.join(
    root,
    "native",
    "computer-control",
    "macos",
    "main.swift",
  );
  const outputRoot = path.join(
    root,
    "vendor",
    "computer-control",
    "darwin-universal",
  );
  const arm = path.join(outputRoot, "oscode-computer-control-arm64");
  const intel = path.join(outputRoot, "oscode-computer-control-x64");
  const universal = path.join(outputRoot, "oscode-computer-control");
  await mkdir(outputRoot, { recursive: true });
  await run("xcrun", [
    "swiftc",
    source,
    "-O",
    "-target",
    "arm64-apple-macos12",
    "-o",
    arm,
  ]);
  await run("xcrun", [
    "swiftc",
    source,
    "-O",
    "-target",
    "x86_64-apple-macos12",
    "-o",
    intel,
  ]);
  await run("xcrun", ["lipo", "-create", arm, intel, "-output", universal]);
  await chmod(universal, 0o755);
  process.stdout.write(`Prepared ${universal}\n`);
} else {
  process.stdout.write(
    "Computer Control uses the pinned Windows helper or native macOS build.\n",
  );
}
