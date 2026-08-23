# osCode release assets

Each operating system has its own native release folder:

- `windows/` — Windows 10-or-newer x64 NSIS installer, manifest, and checksums
- `macos/` — a universal macOS 12 Monterey-or-newer ZIP containing the complete portable `.app`
- `linux/` — x64 DEB and Snap packages

The complete set is created by `.github/workflows/build.yml`. Each native job verifies the packaged app and native llama.cpp command before staging assets. A version tag or a manual run with an existing version tag uploads the verified files to a draft GitHub Release. Signing and Apple notarization credentials are intentionally not stored in this repository.

Model weights are downloaded on demand from the separate osCode Models repository and never appear in these folders or application packages. Register native runners labelled `oscode-release-windows`, `oscode-release-macos`, and `oscode-release-linux`; each should have at least 30 GB free. Ordinary pushes and pull requests use the hosted `quality` job and do not require these release runners.

To create assets, push a `v...` tag or run **Build osCode** manually and provide an existing `v...` tag. Each native job uploads sub-2-GiB parts, checksums, and a manifest to the same draft Release. Review the draft before publishing it.

See [`../docs/RELEASING.md`](../docs/RELEASING.md) for the complete maintainer checklist.
