import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");

if (process.platform !== "darwin")
  throw new Error("The macOS release must be built on macOS");

function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    process.stdout.write(`\n> ${command} ${args.join(" ")}\n`);
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
      env: { ...process.env, ...env },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} exited with code ${code}`)),
    );
  });
}

await run("pnpm", ["run", "release:check-disk"]);
await run("pnpm", ["run", "format:check"]);
await run("pnpm", ["test"]);
await run("pnpm", ["run", "git:prepare"]);
await run("pnpm", ["run", "python:prepare"]);
await run("pnpm", ["run", "llama:prepare"]);
await run("pnpm", ["run", "terminal:prepare"]);
await run("pnpm", ["run", "computer:prepare"]);
await run("pnpm", ["run", "native:check"]);
await run("pnpm", ["exec", "vite", "build"], {
  NODE_OPTIONS: "--max-old-space-size=4096",
});
await run("pnpm", ["run", "smoke:run"]);
await run(
  "pnpm",
  [
    "exec",
    "electron-builder",
    "--mac",
    "dmg",
    "--universal",
    "--publish",
    "never",
  ],
  { CSC_IDENTITY_AUTO_DISCOVERY: "false" },
);
await run(process.execPath, [
  "scripts/verify-package.mjs",
  "macos",
  "--run-smoke",
]);
await run("pnpm", ["run", "release:stage:macos"]);
await fs.rm(path.join(root, "release"), { recursive: true, force: true });

process.stdout.write(
  "\nmacOS release verified and staged in release-assets/macos; intermediate release folder removed\n",
);
