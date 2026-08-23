import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (file) => fs.readFileSync(path.resolve(file), "utf8");

test("the editor registers Monaco's complete built-in language catalog", () => {
  const source = read("src/monaco.ts");
  assert.match(source, /monaco-editor\/languages\/definitions\/register\.all/);
});

test("the installed Monaco catalog includes Swift for SwiftUI source files", () => {
  const swiftRegistration = path.resolve(
    "node_modules/monaco-editor/esm/vs/languages/definitions/swift/register.js",
  );
  assert.equal(fs.existsSync(swiftRegistration), true);
  assert.match(read(swiftRegistration), /extensions:\s*\["\.swift"\]/);
});
