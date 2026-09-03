import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverProjectPythonEnvironments,
  parseCondaEnvironmentPrefixes,
  pythonEnvironmentForInterpreter,
} from "../dist-electron/main/python-project-environments.js";

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "oscode-python-envs-"));
  const root = path.join(base, "project");
  await fs.mkdir(root);
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return root;
}

async function createPosixVenv(root, relative) {
  const environment = path.join(root, relative);
  await fs.mkdir(path.join(environment, "bin"), { recursive: true });
  await fs.writeFile(path.join(environment, "pyvenv.cfg"), "home = /python\n");
  await fs.writeFile(path.join(environment, "bin", "python"), "python\n");
  return environment;
}

test("discovers common and nested PyCharm or monorepo virtual environments", async (t) => {
  const root = await fixture(t);
  await createPosixVenv(root, ".venv");
  await createPosixVenv(root, "services/api/.venv");
  const found = await discoverProjectPythonEnvironments(root, "darwin");
  assert.deepEqual(
    found.map((item) => item.name),
    [".venv", "services/api/.venv"],
  );
  assert.equal(found[0].kind, "venv");
});

test("discovers PyCharm environments with only a versioned Python executable", async (t) => {
  const root = await fixture(t);
  const environment = path.join(root, ".venv");
  await fs.mkdir(path.join(environment, "bin"), { recursive: true });
  await fs.writeFile(path.join(environment, "pyvenv.cfg"), "home = /python\n");
  await fs.writeFile(path.join(environment, "bin", "python3.12"), "python\n");
  const found = await discoverProjectPythonEnvironments(root, "darwin");
  assert.equal(found.length, 1);
  assert.equal(
    found[0].interpreter,
    path.join(await fs.realpath(environment), "bin", "python3.12"),
  );
});

test("discovers project-local Conda environments on Windows", async (t) => {
  const root = await fixture(t);
  const environment = path.join(root, ".conda");
  await fs.mkdir(path.join(environment, "conda-meta"), { recursive: true });
  await fs.writeFile(path.join(environment, "conda-meta", "history"), "");
  await fs.writeFile(path.join(environment, "python.exe"), "python\n");
  const found = await discoverProjectPythonEnvironments(root, "win32");
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "conda");
  assert.equal(
    found[0].interpreter,
    path.join(await fs.realpath(environment), "python.exe"),
  );
  assert.deepEqual(
    await pythonEnvironmentForInterpreter(found[0].interpreter, "win32"),
    { environment: await fs.realpath(environment), kind: "conda" },
  );
});

test("recognizes an interpreter's environment and validates Conda JSON", async (t) => {
  const root = await fixture(t);
  const environment = await createPosixVenv(root, "venv");
  assert.deepEqual(
    await pythonEnvironmentForInterpreter(
      path.join(environment, "bin", "python"),
      "linux",
    ),
    { environment: await fs.realpath(environment), kind: "venv" },
  );
  assert.deepEqual(
    parseCondaEnvironmentPrefixes(
      JSON.stringify({ envs: [environment, "relative", 42] }),
    ),
    [environment],
  );
  assert.deepEqual(parseCondaEnvironmentPrefixes("not json"), []);
});
