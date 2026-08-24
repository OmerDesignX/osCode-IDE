# Local release scripts

Edit only `VERSION.txt` when starting a release. Each operating-system script validates that semantic version and synchronizes it into `package.json` before installing, testing, packaging, verifying, and staging the native artifact.

Run the script on the operating system it targets:

```sh
# macOS 12 or newer
bash releaseScripts/macos/build.sh

# Windows 10, from Git Bash
bash releaseScripts/windows/build-windows-10.sh

# Windows 11, from Git Bash
bash releaseScripts/windows/build-windows-11.sh

# Current x64 Debian or Ubuntu
bash releaseScripts/linux/build.sh
```

The Windows 10 and Windows 11 wrappers intentionally use the same x64 NSIS packaging pipeline; the separate entry points make the host used for verification explicit. Native packages must be built on their matching operating systems.

Verified artifacts are staged in the ignored `release-assets/macos`, `release-assets/windows`, or `release-assets/linux` folder. Electron Builder's intermediate root `release/` folder is ignored by Git and removed after successful staging. The macOS script generates a padded, multi-resolution `.icns` file without changing the Windows/Linux `build/icon.png` asset, then stages separate `mac-arm64` and `mac-x64` DMGs.

The macOS release is unsigned by design. The build disables Electron Builder's certificate discovery, verifies the application contents and native architectures, and stages both DMGs without requiring Apple credentials. macOS may show a Gatekeeper warning because the application is not signed or notarized. A maintainer can opt into a signed build explicitly with `OSCODE_REQUIRE_SIGNED=1 bash releaseScripts/macos/build.sh` after configuring Electron Builder's signing credentials.
