# Releasing osCode

osCode release packages are built locally on each target operating system and uploaded to GitHub Releases manually. The repository does not use GitHub Actions. This keeps native signing credentials and large release dependencies on maintainer-controlled machines while retaining the same local quality, smoke, and package-verification checks.

## GitHub Actions and native releases

GitHub Actions is an optional automation service: a workflow file asks a fresh GitHub-hosted or maintainer-hosted computer to check out the repository and run commands after events such as a push, pull request, version tag, or manual request. It does not make an application cross-platform by itself. A native Windows installer, macOS DMG, or Linux package still has to be built and tested in a matching operating-system environment.

The removed workflow ran formatting and tests on a GitHub-hosted Ubuntu runner, then used separate self-hosted Windows and macOS machines for release packages. It did not build a Linux installer. Removing it therefore did not remove an existing Linux release pipeline; it moved the existing Windows and macOS work to the documented local process.

For this project, a sensible future compromise would be a small GitHub-hosted Linux workflow that:

- runs formatting and tests for pushes and pull requests;
- builds an x64 Linux package only after a manual request or version tag;
- stores the verified package as a workflow artifact for the maintainer to inspect; and
- does not publish a release automatically.

Windows and macOS signing credentials and native packages can remain on maintainer-controlled machines. GitHub Actions is not required for local builds, and adding a Linux-only workflow later would not require rebuilding an already-published Windows installer.

## Release rules

- Build from a clean checkout of the commit that will be tagged.
- Use Node.js 22 or newer and pnpm 11.19.0.
- Keep at least 30 GB free. The release scripts stop below 20 GiB.
- Edit `releaseScripts/VERSION.txt` for a new release. Every platform script validates that value, synchronizes `package.json` before packaging, and derives the matching release tag.
- Build each native package on its own operating system. Do not cross-compile the Windows installer or macOS DMG.
- Do not rebuild an already-published Windows installer unless the version or Windows source has changed.

Native packages never embed model weights. The application downloads a user-selected tier from the public `OmerDesignX/osCode-Models` catalogue, verifies its SHA-256 hashes, and stores it in the user's application-data directory.

## macOS DMG

Prerequisites are macOS 12 or newer, Xcode command-line tools, Node.js, and pnpm. No Apple signing certificate is required. From the repository root, run:

```sh
bash releaseScripts/macos/build.sh
```

The command synchronizes the release version, creates a macOS-only `.icns` with explicit 16, 32, 128, 256, 512, and Retina representations, performs formatting and test checks, prepares the Intel and Apple-silicon Python and llama.cpp runtimes, compiles the universal Computer Control helper, smoke-tests the app before and after packaging, builds separate unsigned arm64 and x64 DMGs, verifies each package architecture and Monterey deployment target, and stages both files at:

```text
release-assets/macos/osCode-<version>-mac-arm64.dmg
release-assets/macos/osCode-<version>-mac-x64.dmg
```

The command removes its intermediate `release/` directory after the verified DMG is staged. The staged DMG is ignored by Git, and the macOS build does not change or regenerate the Windows installer.

The macOS packages are intentionally unsigned and unnotarized. Electron Builder certificate discovery is disabled so packaging never depends on credentials in a maintainer's Keychain. Users should expect macOS Gatekeeper to warn that Apple cannot verify the developer; release notes must identify the packages as unsigned. Signing remains an explicit opt-in with `OSCODE_REQUIRE_SIGNED=1 bash releaseScripts/macos/build.sh` if the release policy changes later.

Both architecture-specific apps launch on macOS 12 Monterey and newer. Use arm64 for Apple silicon and x64 for Intel; do not combine or rename them as a universal build. The padded multi-resolution icon corrects Monterey's oversized presentation without changing the Windows/Linux PNG. Local AI chooses the compatible runtime at run time: Apple-silicon Macs on macOS 14 or newer use the verified MLX variants (Small 21 shards, Medium 27, Large 34), while Apple-silicon Macs on Monterey or Ventura and all Intel Macs use the corresponding GGUF variant through bundled llama.cpp. Current official MLX wheels require macOS 14, so this fallback keeps older supported Macs functional instead of offering an engine that cannot install. If an older osCode build downloaded an MLX model without preparing its isolated runtime, the first prompt now repairs the runtime automatically.

The current release intentionally does not label either DMG as compatible with macOS 10.13 High Sierra. Electron 27 removed High Sierra and Mojave support, while this project uses Electron 35; the current bundled Intel llama.cpp runtime also has a macOS 12 deployment target. Lowering only the package metadata would produce an installer that still cannot launch. A separate High Sierra build would require an end-of-life Electron 26 fork plus separately maintained native and Python runtimes, so the supported and security-maintained Intel baseline remains macOS 12 Monterey.

Project Python environments are created with the bundled `uv` and seeded with `pip`. Selecting a project environment in the interpreter dropdown restarts each shell with that environment's `bin` or `Scripts` directory first on `PATH`, sets `VIRTUAL_ENV`, and makes the bundled `uv` available. Packages can be installed from Python help or with `uv pip install <package>` in the terminal; both target the selected project environment.

## Windows installer

Run the Windows pipeline only when a new Windows package is required. On a native 64-bit Windows host with Git Bash, Node.js, and pnpm, use the wrapper matching the host used for verification:

```sh
bash releaseScripts/windows/build-windows-10.sh
# or
bash releaseScripts/windows/build-windows-11.sh
```

Both wrappers use the same Windows 10-or-newer x64 NSIS configuration. The uploadable file is `release-assets/windows/osCode-Setup-<version>.exe`. Do not rename or relabel an existing installer as a newer release; run the Windows script whenever a new Windows asset is included.

## Linux source and package support

Linux remains supported and its Electron Builder configuration is unchanged. The current target is x64 Debian or Ubuntu: the default package is a `.deb`, with a separate Snap configuration. The preparation scripts bundle x64 uv, Python 3.10/3.11/3.12, and pinned CPU and Vulkan llama.cpp runtimes. Linux ARM packages are not currently supported.

Ordinary users should not be expected to compile osCode. Once a Linux package is published, a Debian or Ubuntu user should be able to download the `.deb` and install it with:

```sh
sudo apt install ./<downloaded-osCode-package>.deb
```

Contributors can run the source checkout with `pnpm dev`. Maintainers building distributable packages should use a current x64 Debian or Ubuntu computer or virtual machine with a graphical session, Git, Node.js 22 or newer, pnpm 11.19.0, standard native build tools, `xvfb`, and the Electron Builder prerequisites for Debian packages. Snap creation also requires the Snap packaging tools. Linux secure storage requires a Secret Service or KWallet backend; osCode intentionally refuses Electron's unprotected `basic_text` fallback.

From a clean repository checkout, run the one-command Debian package pipeline:

```sh
bash releaseScripts/linux/build.sh
```

It synchronizes the version, runs the same quality/native preparation checks, smoke-tests through `xvfb-run`, builds and verifies the x64 `.deb`, and stages it at:

```text
release-assets/linux/osCode-<version>-x64.deb
```

The regular Linux script intentionally produces the requested Debian package only. A maintainer who also wants the optional Snap can still run its separate Electron Builder configuration and the full two-artifact verifier documented in `build/electron-builder.linux-snap.cjs`.

Before adding Linux to a public release, run this script on a clean Ubuntu or Debian machine and inspect the staged package. Ordinary Linux users install the published file rather than compiling the project.

Most osCode functionality is available on Linux, including the editor, terminal, Git, contained Python, local AI, and the dedicated agent browser. Native control of arbitrary desktop applications is currently limited to Windows and macOS; on Linux, Computer Control remains available inside osCode and its dedicated browser.

## Publish manually

1. Confirm `git status --short` is empty and the version tag points to the exact source commit used for the build.
2. On GitHub, create or open the draft release for that tag.
3. Upload each verified artifact you are publishing for this version: `osCode-Setup-<version>.exe`, `osCode-<version>-mac-arm64.dmg`, `osCode-<version>-mac-x64.dmg`, and, when Linux is included, `osCode-<version>-x64.deb`.
4. Confirm every uploaded filename contains the release version and each asset is below GitHub's 2 GiB per-asset limit.
5. Review the release notes and publish the draft.

The release must not remain a draft for installed clients to discover it, and its semantic version must be newer than the version inside an installed app.

## Unsigned macOS releases

Windows and Apple signing credentials are not committed. The macOS DMGs are built without signing or notarization by design. This avoids credential handling but means Gatekeeper may warn users or require them to approve opening osCode from macOS Privacy & Security settings. Do not describe these artifacts as signed or notarized in the GitHub release. If the policy changes later, `OSCODE_REQUIRE_SIGNED=1` enables the existing Developer ID verification path.

## Safety

Release preparation uses network access only to install locked dependencies and fetch checksum-pinned runtimes. Application telemetry remains disabled. Do not commit generated packages, downloaded runtimes, credentials, or model weights.

## Release checks

- Confirm Monterey displays the macOS icon at a normal visual size and that `build/icon.png` remains byte-for-byte unchanged for Windows and Linux.
- Open at least two editor tabs, enable Split, and choose a different open tab for the Left and Right pane.
- Create a project `.venv`, select it in the interpreter dropdown, confirm `python` and `uv` resolve inside the terminal, and install a small package through Python help.
- Enable Files and Edits, confirm the status says the model was updated, and ask llama.cpp, MLX, PyTorch, and Ollama to create a small file in a disposable project. Every engine uses the same permission correction, autonomous tool loop, goals, queue, and action history.
- Confirm llama.cpp and MLX report local generation progress, PyTorch reports prompt and streamed output-token progress, and Ollama streams reasoning, answers, and native tool calls instead of waiting for one opaque response.
- Build each artifact only on its matching host with the scripts under `releaseScripts/`.
