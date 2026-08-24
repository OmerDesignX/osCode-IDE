import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const target = path.join(root, "release");
if (path.dirname(target) !== root || path.basename(target) !== "release")
  throw new Error(`Refusing to clean unexpected path ${target}`);
await fs.rm(target, { recursive: true, force: true });
console.log("Removed the intermediate release/ directory");
