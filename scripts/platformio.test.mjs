import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PlatformioService,
  platformioValidation,
} from "../dist-electron/main/platformio.js";

test("PlatformIO state detects projects without enabling telemetry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-platformio-"));
  const data = path.join(root, "data");
  const project = path.join(root, "project");
  await fs.mkdir(project);
  await fs.writeFile(
    path.join(project, "platformio.ini"),
    "[platformio]\ndefault_envs = uno\n\n[env:uno]\nplatform = atmelavr\n\n[env:esp32-dev]\nplatform = espressif32\n",
  );
  try {
    const service = new PlatformioService(
      data,
      async () => "unused",
      () => {},
    );
    const state = await service.state(project);
    assert.equal(state.telemetry, false);
    assert.equal(state.installed, false);
    assert.equal(state.project, true);
    assert.deepEqual(state.environments, ["uno", "esp32-dev"]);
    assert.equal(state.autoUpdate, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("PlatformIO command fields reject shell syntax", () => {
  assert.equal(platformioValidation.validEnvironment("esp32-dev"), true);
  assert.equal(platformioValidation.validEnvironment("esp32; rm -rf"), false);
  assert.equal(platformioValidation.validBoard("uno"), true);
  assert.equal(platformioValidation.validBoard("uno && echo bad"), false);
  assert.equal(platformioValidation.validFramework("arduino"), true);
  assert.equal(platformioValidation.validFramework("$(whoami)"), false);
});
