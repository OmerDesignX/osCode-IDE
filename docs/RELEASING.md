# Releasing osCode

osCode releases are built from a version tag by `.github/workflows/build.yml`. The workflow keeps release files in a draft until a maintainer reviews and publishes them.

## Native runners

Register dedicated self-hosted GitHub Actions runners with these labels:

- `oscode-release-windows` — Windows 10 or newer, x64
- `oscode-release-macos` — macOS 12 or newer, Intel or Apple silicon
- `oscode-release-linux` — Debian or Ubuntu, x64

Each runner should have at least 30 GB free. The workflow stops below 20 GiB. Keep runner operating systems and security updates current; do not reuse a release runner for untrusted pull-request workflows.

The workflow installs Node, pnpm, project dependencies, and Linux packaging tools. Native platform prerequisites still need to exist on the host: PowerShell on Windows, Xcode command-line tools on macOS, and `sudo` access for the Linux packaging-tool step.

## Model access

Native packages never check out or embed model weights. The application downloads a user-selected tier from the public `OmerDesignX/osCode-Models` catalogue, verifies its SHA-256 hashes, and stores it in the user's application-data directory.

## Build a draft

1. Update and test the source on the default branch.
2. Create and push a tag whose name begins with `v`, such as `v0.1.0`.
3. Wait for the **Build osCode** workflow's `quality` and three `desktop` matrix jobs.
4. Open the resulting draft GitHub Release.
5. Confirm that Windows, macOS, and Linux manifests and SHA-256 files are present and that every listed part was uploaded.
6. Download one artifact, verify its checksum, and confirm that it contains no `resources/models` directory.
7. Publish the draft only after native smoke checks and release notes have been reviewed.

The workflow can also be started manually. Manual runs require an existing `v...` tag and upload to a draft for that tag.

## Outputs

- Windows: NSIS installer, block map, and `latest.yml`
- macOS: portable ZIP and `latest-mac.yml`
- Linux: DEB/Snap package and `latest-linux.yml`

Publish the draft only after the update metadata and its referenced package are present. The GitHub release must not remain a draft for installed clients to discover it, and its semantic version must be newer than the version inside the installed app.

Files at or above GitHub's 2 GiB per-asset limit are divided into numbered parts. Each platform manifest records the original artifact hash, part hashes, and byte sizes. Platform READMEs contain reassembly commands.

## Signing

Windows code signing and Apple signing/notarization credentials are not committed. Unsigned development releases can be produced for testing, but a public production release should be signed and, on macOS, notarized through protected runner secrets and a reviewed signing workflow.

## Safety

Release jobs use network access only to install declared build dependencies, fetch pinned runtimes, and upload draft assets. Application telemetry remains disabled. The release uploader requires the tag to exist, uploads only to a draft, and refuses to replace assets after publication.
