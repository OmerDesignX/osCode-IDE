import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ProjectMemoryStore,
  projectMemoryPrompt,
  rankProjectMemoryFiles,
  summarizeProjectFile,
} from "../dist-electron/main/project-memory.js";

test("project memory extracts useful metadata without retaining source text", () => {
  const memory = summarizeProjectFile(
    "src/payment-service.ts",
    [
      'import { audit } from "./audit";',
      "export class PaymentService {}",
      "export function reconcileInvoice() {}",
      "// exact private body phrase should not be persisted",
    ].join("\n"),
    180,
    42,
  );
  assert.equal(memory.language, "TypeScript");
  assert.deepEqual(memory.imports, ["./audit"]);
  assert.deepEqual(memory.symbols, ["PaymentService", "reconcileInvoice"]);
  assert.doesNotMatch(JSON.stringify(memory), /exact private body phrase/);
});

test("project memory is encrypted, persistent, and ranks exact project files", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-memory-"));
  const project = path.join(base, "project");
  const userData = path.join(base, "user-data");
  await fs.mkdir(path.join(project, "src"), { recursive: true });
  await fs.writeFile(
    path.join(project, "src", "payment-service.ts"),
    [
      'import { audit } from "./audit";',
      "export class PaymentService {}",
      "// exact private body phrase should never be stored",
    ].join("\n"),
  );

  try {
    const store = new ProjectMemoryStore(userData);
    const memory = await store.refresh(project, ["src/payment-service.ts"]);
    await store.remember(project, {
      tool: "replace_in_file",
      status: "completed",
      detail: "Updated src/payment-service.ts",
      files: ["src/payment-service.ts"],
    });

    const ranked = rankProjectMemoryFiles(
      memory,
      "update PaymentService reconciliation",
    );
    assert.equal(ranked[0]?.path, "src/payment-service.ts");
    assert.match(
      projectMemoryPrompt(memory, "update PaymentService"),
      /src\/payment-service\.ts/,
    );

    const secureFiles = [];
    const visit = async (directory) => {
      for (const entry of await fs.readdir(directory, {
        withFileTypes: true,
      })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(target);
        else secureFiles.push(target);
      }
    };
    await visit(path.join(userData, "secure"));
    const encrypted = Buffer.concat(
      await Promise.all(secureFiles.map((file) => fs.readFile(file))),
    ).toString("utf8");
    assert.doesNotMatch(encrypted, /exact private body phrase/);
    assert.doesNotMatch(encrypted, /payment-service\.ts/);

    const reloaded = new ProjectMemoryStore(userData);
    const persisted = await reloaded.refresh(project, [
      "src/payment-service.ts",
    ]);
    assert.equal(persisted.actions[0]?.tool, "replace_in_file");
    assert.equal(persisted.files[0]?.path, "src/payment-service.ts");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
