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
- Keep `package.json`'s version and the release tag aligned. Version `0.1.0` uses tag `v0.1.0`.
- Build each native package on its own operating system. Do not cross-compile the Windows installer or macOS DMG.
- Do not rebuild an already-published Windows installer unless the version or Windows source has changed.

Native packages never embed model weights. The application downloads a user-selected tier from the public `OmerDesignX/osCode-Models` catalogue, verifies its SHA-256 hashes, and stores it in the user's application-data directory.

## macOS DMG

Prerequisites are macOS 12 or newer, Xcode command-line tools, Node.js, and pnpm. From the repository root, run:

```sh
pnpm install --frozen-lockfile
pnpm run release:build:macos
```

The command performs formatting and test checks, prepares the Intel and Apple-silicon Python and llama.cpp runtimes, compiles the universal Computer Control helper, smoke-tests the app before and after packaging, builds a universal DMG, verifies the package contents and architectures, and stages the final file at:

```text
release-assets/macos/osCode-<version>.dmg
```

The command removes its intermediate `release/` directory after the verified DMG is staged. The staged DMG is ignored by Git, and the macOS build does not change or regenerate the Windows installer.

The universal app launches on macOS 12 Monterey and newer. Local AI chooses the compatible runtime at run time: Apple-silicon Macs on macOS 14 or newer use the verified MLX variants (Small 21 shards, Medium 27, Large 34), while Apple-silicon Macs on Monterey or Ventura and all Intel Macs use the corresponding GGUF variant through bundled llama.cpp. Current official MLX wheels require macOS 14, so this fallback keeps older supported Macs functional instead of offering an engine that cannot install. If an older osCode build downloaded an MLX model without preparing its isolated runtime, the first prompt now repairs the runtime automatically.

## Windows installer

Run the existing Windows pipeline only when a new Windows package is required. On a 64-bit Windows 10 or newer host with PowerShell, Node.js, and pnpm:

```powershell
pnpm install --frozen-lockfile
pnpm run release:check-disk
pnpm run format:check
pnpm test
pnpm run git:prepare
pnpm run python:prepare
pnpm run llama:prepare
pnpm run terminal:prepare
pnpm run computer:prepare
pnpm run native:check
pnpm exec vite build
pnpm run smoke:run
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
pnpm exec electron-builder --win nsis --x64 --publish never
node scripts/verify-package.mjs windows --run-smoke
pnpm run release:stage:windows
```

The uploadable file is `release-assets/windows/osCode-Setup-<version>.exe`.

## Linux source and package support

Linux remains supported and its Electron Builder configuration is unchanged. The current target is x64 Debian or Ubuntu: the default package is a `.deb`, with a separate Snap configuration. The preparation scripts bundle x64 uv, Python 3.10/3.11/3.12, and pinned CPU and Vulkan llama.cpp runtimes. Linux ARM packages are not currently supported.

Ordinary users should not be expected to compile osCode. Once a Linux package is published, a Debian or Ubuntu user should be able to download the `.deb` and install it with:

```sh
sudo apt install ./<downloaded-osCode-package>.deb
```

Contributors can run the source checkout with `pnpm dev`. Maintainers building distributable packages should use a current x64 Debian or Ubuntu computer or virtual machine with a graphical session, Git, Node.js 22 or newer, pnpm 11.19.0, standard native build tools, `xvfb`, and the Electron Builder prerequisites for Debian packages. Snap creation also requires the Snap packaging tools. Linux secure storage requires a Secret Service or KWallet backend; osCode intentionally refuses Electron's unprotected `basic_text` fallback.

From a clean repository checkout, prepare and test the native dependencies before packaging:

```sh
pnpm install --frozen-lockfile
pnpm run release:check-disk
pnpm run format:check
pnpm test
pnpm run git:prepare
pnpm run python:prepare
pnpm run llama:prepare
pnpm run terminal:prepare
pnpm run computer:prepare
pnpm run native:check
pnpm exec vite build
xvfb-run -a pnpm run smoke:run
```

Build both currently configured Linux formats:

```sh
pnpm exec electron-builder --linux deb --x64 --publish never
pnpm exec electron-builder --config build/electron-builder.linux-snap.cjs --linux snap --x64 --publish never
node scripts/verify-package.mjs linux --run-smoke
```

The verifier expects both the `.deb` and `.snap` artifacts and smoke-tests the unpacked application through `xvfb-run`. Successful files are created under `release/`; there is not yet a one-command Linux build or staging script equivalent to `release:build:macos`.

The current public release remains the existing Windows installer plus the macOS DMG. Before adding Linux to a public release, run the full sequence on a clean Ubuntu or Debian machine, inspect the package, and copy the approved artifact into an ignored `release-assets/linux` staging folder for manual upload.

Most osCode functionality is available on Linux, including the editor, terminal, Git, contained Python, local AI, and the dedicated agent browser. Native control of arbitrary desktop applications is currently limited to Windows and macOS; on Linux, Computer Control remains available inside osCode and its dedicated browser.

## Publish manually

1. Confirm `git status --short` is empty and the version tag points to the exact source commit used for the build.
2. On GitHub, create or open the draft release for that tag.
3. Upload the existing `osCode-Setup-<version>.exe` from `release-assets/windows` and the new `osCode-<version>.dmg` from `release-assets/macos`.
4. Confirm the release contains exactly those two assets and each is below GitHub's 2 GiB per-asset limit.
5. Review the release notes and publish the draft.

The release must not remain a draft for installed clients to discover it, and its semantic version must be newer than the version inside an installed app.

## Signing and notarization

Windows code-signing and Apple signing/notarization credentials are not committed. The local macOS command disables automatic certificate discovery so it can reliably create an unsigned development DMG. Before a broad public release, sign the app with a Developer ID Application certificate and notarize it with Apple; otherwise Gatekeeper will warn users and may block normal launching on other Macs.

## Safety

Release preparation uses network access only to install locked dependencies and fetch checksum-pinned runtimes. Application telemetry remains disabled. Do not commit generated packages, downloaded runtimes, credentials, or model weights.
