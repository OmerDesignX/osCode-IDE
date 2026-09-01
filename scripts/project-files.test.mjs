import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  duplicateProjectEntry,
  transferProjectEntry,
  validateProjectItemName,
} from "../dist-electron/main/project-files.js";

async function projectFixture(t) {
  const base = await fs.mkdtemp(
    path.join(os.tmpdir(), "oscode-project-files-"),
  );
  const root = path.join(base, "project");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "archive"));
  await fs.writeFile(path.join(root, "src", "main.ts"), "saved\n");
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, root };
}

test("project item names stay portable across macOS, Windows, and Linux", () => {
  assert.equal(validateProjectItemName(" component.tsx "), "component.tsx");
  for (const name of ["", ".", "..", "folder/name", "bad:name", "trail."])
    assert.throws(() => validateProjectItemName(name));
});

test("duplicate preserves unsaved text and creates stable unique names", async (t) => {
  const { root } = await projectFixture(t);
  const source = path.join(root, "src", "main.ts");
  const first = await duplicateProjectEntry(root, source, "unsaved\n");
  const second = await duplicateProjectEntry(root, source);
  assert.equal(first.name, "main copy.ts");
  assert.equal(second.name, "main copy 2.ts");
  assert.equal(await fs.readFile(first.newPath, "utf8"), "unsaved\n");
  assert.equal(await fs.readFile(second.newPath, "utf8"), "saved\n");
});

test("copy and move work recursively without overwriting project items", async (t) => {
  const { root } = await projectFixture(t);
  const sourceDirectory = path.join(root, "src");
  const copied = await transferProjectEntry(
    root,
    sourceDirectory,
    path.join(root, "archive"),
    "copy",
  );
  assert.equal(
    await fs.readFile(path.join(copied.newPath, "main.ts"), "utf8"),
    "saved\n",
  );
  const copiedAgain = await transferProjectEntry(
    root,
    sourceDirectory,
    path.join(root, "archive"),
    "copy",
  );
  assert.equal(copiedAgain.name, "src copy");
  const moved = await transferProjectEntry(
    root,
    path.join(root, "src", "main.ts"),
    root,
    "move",
  );
  assert.equal(moved.newPath, path.join(await fs.realpath(root), "main.ts"));
  await assert.rejects(fs.stat(path.join(root, "src", "main.ts")));
});

test("file operations reject paths outside the project and recursive self moves", async (t) => {
  const { base, root } = await projectFixture(t);
  const outside = path.join(base, "outside.txt");
  await fs.writeFile(outside, "private\n");
  await assert.rejects(duplicateProjectEntry(root, outside), /outside/);
  await assert.rejects(
    transferProjectEntry(
      root,
      path.join(root, "src"),
      path.join(root, "src"),
      "move",
    ),
    /inside itself/,
  );
});
