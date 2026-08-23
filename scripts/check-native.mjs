import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const nodePty = await import("node-pty");

if (typeof nodePty.spawn !== "function") {
  throw new Error("node-pty did not expose a terminal spawn function");
}

console.log(`node-pty is available for ${process.platform}-${process.arch}`);

function run(executable, args, env = {}) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(executable, args, {
      windowsHide: true,
      shell: false,
      env: { ...process.env, ...env },
    });
    child.stdout.on("data", (data) => (stdout += String(data)));
    child.stderr.on("data", (data) => (stderr += String(data)));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0)
        reject(new Error(stderr.trim() || `${executable} exited with ${code}`));
      else resolve(stdout.trim());
    });
  });
}

let computerHelper = "";
let computerArgs = [];
if (process.platform === "win32") {
  computerHelper = path.resolve(
    "node_modules",
    "@microsoft",
    "winappcli",
    "bin",
    "win-x64",
    "winapp.exe",
  );
  computerArgs = ["ui", "list-windows", "--json"];
} else if (process.platform === "darwin") {
  computerHelper = path.resolve(
    "vendor",
    "computer-control",
    "darwin-universal",
    "oscode-computer-control",
  );
  computerArgs = ["list"];
}

if (computerHelper) {
  await access(computerHelper);
  const output = await run(computerHelper, computerArgs, {
    WINAPP_CLI_TELEMETRY_OPTOUT: "1",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  });
  if (!Array.isArray(JSON.parse(output)))
    throw new Error("Computer Control helper did not return a window list");
  console.log(
    `Computer Control is available for ${process.platform}-${process.arch}`,
  );
}
