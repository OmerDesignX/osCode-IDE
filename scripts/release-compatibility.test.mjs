import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("release metadata keeps the requested desktop compatibility", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.devDependencies.electron, "^35.0.0");
  assert.equal(manifest.build.mac.minimumSystemVersion, "12.0");
  assert.deepEqual(manifest.build.mac.target, ["zip"]);
  assert.ok(manifest.build.win.target[0].arch.includes("x64"));
  for (const platform of ["mac", "win", "linux"])
    assert.equal(manifest.build[platform].icon, "build/icon.png");

  const readme = read("README.md");
  assert.match(readme, /Windows 10 or newer/);
  assert.match(readme, /macOS 12 Monterey or newer/);
});

test("brand assets use the baby-blue palette and a production icon", () => {
  const css = read("src/styles.css").toLowerCase();
  assert.match(css, /--baby-200:\s*#89cff0/);
  assert.doesNotMatch(css, /#81d8d0|#55c9c0|tiffany/);

  const icon = readFileSync(path.join(root, "build", "icon.png"));
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(icon.readUInt32BE(16) >= 1024);
  assert.ok(icon.readUInt32BE(20) >= 1024);
  assert.match(read("src/App.tsx"), /Open or create a file/);
});

test("native releases package local inference runtimes without model weights or a server", () => {
  const manifest = JSON.parse(read("package.json"));
  const windowsResources = manifest.build.win.extraResources;
  const macResources = manifest.build.mac.extraResources.map(
    ({ from }) => from,
  );
  const linuxResources = manifest.build.linux.extraResources.map(
    ({ from }) => from,
  );
  assert.ok(macResources.includes("vendor/llama/darwin-arm64"));
  assert.ok(macResources.includes("vendor/llama/darwin-x64"));
  assert.ok(!macResources.some((value) => value.includes("vendor/models")));
  assert.deepEqual(
    windowsResources.find(({ from }) => from === "vendor/llama/win32-x64")
      ?.filter,
    ["llama-completion.exe", "*.dll", "!llama-server-impl.dll"],
  );
  assert.deepEqual(
    windowsResources.find(
      ({ from }) => from === "vendor/llama/win32-x64-vulkan",
    )?.filter,
    ["llama-completion.exe", "llama-cli.exe", "*.dll", "OSCODE_RUNTIME.json"],
  );
  assert.deepEqual(
    windowsResources.find(
      ({ from }) => from === "vendor/llama/win32-x64-cuda-13.3",
    )?.filter,
    ["llama-completion.exe", "llama-cli.exe", "*.dll", "OSCODE_RUNTIME.json"],
  );
  assert.deepEqual(
    windowsResources.find(
      ({ from }) => from === "vendor/llama/win32-x64-cuda-12.4",
    )?.filter,
    ["llama-completion.exe", "llama-cli.exe", "*.dll", "OSCODE_RUNTIME.json"],
  );
  assert.ok(linuxResources.includes("vendor/llama/linux-x64"));
  assert.ok(linuxResources.includes("vendor/llama/linux-x64-vulkan"));
  assert.ok(!linuxResources.some((value) => value.includes("vendor/models")));

  const snapConfig = read("build/electron-builder.linux-snap.cjs");
  assert.doesNotMatch(snapConfig, /vendor\/models/);
  const prepareLlama = read("scripts/prepare-llama.mjs");
  assert.match(prepareLlama, /llama-completion/);
  assert.match(prepareLlama, /win32-x64-vulkan/);
  assert.match(prepareLlama, /llama-b10517-bin-win-cuda-12\.4-x64\.zip/);
  assert.match(prepareLlama, /llama-b10517-bin-win-cuda-13\.3-x64\.zip/);
  assert.match(
    prepareLlama,
    /e144d3291f4f2615ed9af1baa39b6f4777591188c31e18f0f0a8ba5e4cb1db13/,
  );
  assert.match(
    prepareLlama,
    /cbfac1e655d550df2515bac060b6410f9ed6aabc7df014353481608ac514b6dd/,
  );
  assert.doesNotMatch(prepareLlama, /cudart-llama-bin-win-cuda/);
  assert.doesNotMatch(prepareLlama, /keep[\s\S]*llama-server/);
  assert.match(prepareLlama, /llama-server-impl\.dll/);

  const aiService = read("electron/main/ai.ts");
  assert.match(
    aiService,
    /if \(hardware === "cpu"\) inferenceArguments\.push\("--gpu-layers", "0"\)/,
  );
  assert.doesNotMatch(aiService, /hardware === "cpu" \? "0" : "999"/);
  assert.match(aiService, /current\.acceleratorVersion\?\.startsWith\("12"\)/);
  const bundledModelRuntime = read("electron/main/bundled-models.ts");
  assert.match(bundledModelRuntime, /if \(left\.major === "12"\) return -1/);
  assert.match(
    read("scripts/verify-package.mjs"),
    /Bundled llama\.cpp CUDA \$\{cuda\.version\} command/,
  );
  assert.match(
    read("scripts/verify-package.mjs"),
    /NVIDIA CUDA runtime libraries must not be packaged/,
  );
  assert.match(read("scripts/verify-package.mjs"), /Server runtime artifacts/);
  assert.match(read("electron/main/bundled-models.ts"), /accelerator: "cuda"/);
  assert.match(read("electron/main/bundled-models.ts"), /cuda-system-/);
  assert.match(read("electron/main/bundled-models.ts"), /CUDA_PATH/);
  assert.match(read("electron/main/bundled-models.ts"), /nvidia-smi/);
  assert.match(read("electron/main/bundled-models.ts"), /cudaInstallSupported/);
  assert.match(read("electron/main/ai.ts"), /profile\.accelerator === "cuda"/);
  assert.match(read("electron/main/ai.ts"), /installCudaSupport/);
  assert.match(read("electron/main/ai.ts"), /cudart-llama-bin-win-cuda-12\.4/);
  assert.match(
    read("electron/main/ai.ts"),
    /download\.pytorch\.org\/whl\/\$\{pytorchCuda/,
  );
  assert.doesNotMatch(
    read("electron/main/ai.ts"),
    /hardware === "cpu" \? "0" : "999"/,
  );
  assert.match(
    read("electron/main/ai.ts"),
    /process\.platform.*process\.arch/s,
  );

  const preparePython = read("scripts/prepare-python.mjs");
  assert.match(preparePython, /\["darwin-arm64", "darwin-x64"\]/);
  assert.match(preparePython, /cpython-\$\{pythonVersion\}-macos-/);
  assert.match(
    read("electron/main/index.ts"),
    /return path\.join\(root, `\$\{process\.platform\}-\$\{process\.arch\}`\)/,
  );
});

test("native Computer Control is local, permissioned, and packaged", () => {
  const manifest = JSON.parse(read("package.json"));
  const windowsResources = manifest.build.win.extraResources.map(
    ({ from }) => from,
  );
  const macResources = manifest.build.mac.extraResources.map(
    ({ from }) => from,
  );
  assert.equal(manifest.devDependencies["@microsoft/winappcli"], "0.5.0");
  assert.ok(
    windowsResources.includes("node_modules/@microsoft/winappcli/bin/win-x64"),
  );
  assert.ok(macResources.includes("vendor/computer-control/darwin-universal"));

  const control = read("electron/main/agent-control.ts");
  assert.match(control, /WINAPP_CLI_TELEMETRY_OPTOUT: "1"/);
  assert.match(control, /DOTNET_CLI_TELEMETRY_OPTOUT: "1"/);
  assert.match(control, /UI Automation|nativeArgs\("invoke"/);
  assert.match(control, /Computer Control cannot operate terminals/);
  assert.match(
    read("native/computer-control/macos/main.swift"),
    /kAXPressAction/,
  );
  assert.match(
    read("native/computer-control/macos/main.swift"),
    /AXIsProcessTrustedWithOptions/,
  );
  assert.match(
    read("scripts/prepare-computer-control.mjs"),
    /arm64-apple-macos12/,
  );
  assert.match(
    read("scripts/prepare-computer-control.mjs"),
    /x86_64-apple-macos12/,
  );
  assert.match(
    read(".github/workflows/build.yml"),
    /pnpm run computer:prepare/,
  );
});

test("release workflow uses native runners and publishes verified packages", () => {
  const workflow = read(".github/workflows/build.yml");
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /desktop:[\s\S]*permissions:\s+contents: write/);
  for (const label of [
    "oscode-release-windows",
    "oscode-release-macos",
    "oscode-release-linux",
  ])
    assert.match(workflow, new RegExp(label));
  assert.match(workflow, /pnpm run llama:prepare/);
  assert.match(workflow, /pnpm run release:check-disk/);
  assert.doesNotMatch(workflow, /linux:package-models|models:prepare/);
  assert.match(workflow, /scripts\/upload-release-assets\.mjs/);

  const stageNative = read("scripts/stage-native-release.mjs");
  assert.match(stageNative, /1_900_000_000/);
  assert.match(stageNative, /SHA256SUMS/);
  const upload = read("scripts/upload-release-assets.mjs");
  assert.match(upload, /2 \* 1024 \* 1024 \* 1024/);
  assert.match(upload, /https:\/\/api\.github\.com\/repos/);
  assert.match(upload, /https:\/\/uploads\.github\.com\/repos/);
  assert.match(upload, /refusing to replace public assets/);
  assert.doesNotMatch(upload, /spawnSync\("gh"/);

  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.dependencies["electron-updater"], "^6.8.9");
  assert.deepEqual(manifest.build.publish, [
    {
      provider: "github",
      owner: "OmerDesignX",
      repo: "osCode-IDE",
    },
  ]);
  assert.match(read("scripts/stage-windows-release.mjs"), /latest\.yml/);
  assert.match(read("scripts/stage-native-release.mjs"), /latest-mac\.yml/);
  assert.match(read("scripts/stage-native-release.mjs"), /latest-linux\.yml/);
  assert.match(
    read("electron/main/index.ts"),
    /app\.commandLine\.hasSwitch\("smoke-test"\)/,
  );
});

test("model tiers are downloaded on demand from the separate verified catalogue", () => {
  const catalogue = read("electron/main/model-catalog.ts");
  assert.match(catalogue, /OmerDesignX\/osCode-Models/);
  assert.match(catalogue, /SHA256SUMS/);
  assert.match(catalogue, /Checksum verification failed/);
  assert.match(catalogue, /\.downloads/);
  assert.match(catalogue, /fs\.rename\(staging, finalDirectory\)/);
  for (const tier of ["small", "medium", "large"])
    assert.match(catalogue, new RegExp(`tier: "${tier}"`));

  const manifest = JSON.parse(read("package.json"));
  for (const platform of ["mac", "win", "linux"])
    assert.ok(
      !manifest.build[platform].extraResources.some(({ from }) =>
        from.includes("vendor/models"),
      ),
    );
  assert.equal(manifest.build.nsis.include, undefined);
});
