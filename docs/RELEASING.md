# Releasing osCode

osCode releases are built from a version tag by `.github/workflows/build.yml`. The workflow keeps release files in a draft until a maintainer reviews and publishes them.

## Native runners

Register dedicated self-hosted GitHub Actions runners with these labels:

- `oscode-release-windows` — Windows 10 or newer, x64
- `oscode-release-macos` — macOS 12 or newer, Intel or Apple silicon

Each runner should have at least 30 GB free. The workflow stops below 20 GiB. Keep runner operating systems and security updates current; do not reuse a release runner for untrusted pull-request workflows.

The workflow installs Node, pnpm, and project dependencies. Native platform prerequisites still need to exist on the host: PowerShell on Windows and Xcode command-line tools on macOS.

## Model access

Native packages never check out or embed model weights. The application downloads a user-selected tier from the public `OmerDesignX/osCode-Models` catalogue, verifies its SHA-256 hashes, and stores it in the user's application-data directory.

## Build a draft

1. Update and test the source on the default branch.
2. Create and push a tag whose name begins with `v`, such as `v0.1.0`.
3. Wait for the **Build osCode** workflow's `quality` and two `desktop` matrix jobs.
4. Open the resulting draft GitHub Release.
5. Confirm that the release contains exactly `osCode-Setup-<version>.exe` and `osCode-<version>.dmg`.
6. Download each artifact, verify GitHub reports a SHA-256 digest, and confirm that neither package contains model weights or an Ollama Desktop installer.
7. Publish the draft only after native smoke checks and release notes have been reviewed.

The workflow can also be started manually. Manual runs require an existing `v...` tag and upload to a draft for that tag.

## Outputs

- Windows: `osCode-Setup-<version>.exe`
- macOS: `osCode-<version>.dmg`

No block map, update YAML, checksum text, manifest, portable ZIP, DEB, or Snap is uploaded. The in-app updater reads the stable GitHub release directly, downloads the complete native package, and checks the SHA-256 digest reported by GitHub. The release must not remain a draft for installed clients to discover it, and its semantic version must be newer than the version inside the installed app. Each package must remain below GitHub's 2 GiB per-asset limit.

## Signing

Windows code signing and Apple signing/notarization credentials are not committed. Unsigned development releases can be produced for testing, but a public production release should be signed and, on macOS, notarized through protected runner secrets and a reviewed signing workflow.

## Safety

Release jobs use network access only to install declared build dependencies, fetch pinned runtimes, and upload draft assets. Application telemetry remains disabled. The release uploader requires the tag to exist, uploads only to a draft, and refuses to replace assets after publication.
