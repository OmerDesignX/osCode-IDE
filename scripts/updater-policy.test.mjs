import assert from "node:assert/strict";
import test from "node:test";
import {
  isNewerVersion,
  isTrustedUpdateUrl,
  updateAssetName,
} from "../dist-electron/main/updater-policy.js";

test("application updates are network silent until the user opts in", () => {
  assert.equal(
    isTrustedUpdateUrl(
      false,
      "https://api.github.com/repos/OmerDesignX/osCode-IDE/releases/latest",
    ),
    false,
  );
});

test("application updates accept only the official HTTPS GitHub hosts", () => {
  for (const url of [
    "https://api.github.com/repos/OmerDesignX/osCode-IDE/releases/latest",
    "https://github.com/OmerDesignX/osCode-IDE/releases/download/v0.2.0/osCode.exe",
    "https://release-assets.githubusercontent.com/github-production-release-asset/file",
  ])
    assert.equal(isTrustedUpdateUrl(true, url), true);
  for (const url of [
    "http://github.com/OmerDesignX/osCode-IDE/releases",
    "https://github.example.com/update.yml",
    "https://example.com/latest.yml",
  ])
    assert.equal(isTrustedUpdateUrl(true, url), false);
});

test("full-package updates select one native release asset", () => {
  assert.equal(updateAssetName("1.2.3", "win32"), "osCode-Setup-1.2.3.exe");
  assert.equal(
    updateAssetName("1.2.3", "darwin", "arm64"),
    "osCode-1.2.3-mac-arm64.dmg",
  );
  assert.equal(
    updateAssetName("1.2.3", "darwin", "x64"),
    "osCode-1.2.3-mac-x64.dmg",
  );
  assert.equal(updateAssetName("1.2.3", "darwin", "ia32"), "");
  assert.equal(updateAssetName("1.2.3", "linux"), "");
  assert.equal(isNewerVersion("0.2.0", "0.1.9"), true);
  assert.equal(isNewerVersion("0.1.0", "0.1.0"), false);
});
