# Local release scripts

Edit only `VERSION.txt` when starting a release. Each operating-system script validates that semantic version and synchronizes it into `package.json` before installing, testing, packaging, verifying, and staging the native artifact.

Run the script on the operating system it targets:

```sh
# macOS 12 or newer
bash releaseScripts/macos/build.sh

# Windows 10 or Windows 11, from PowerShell or Command Prompt
.\releaseScripts\windows\build-windows.cmd

# Current x64 Debian or Ubuntu
bash releaseScripts/linux/build.sh
```

Windows 10 and Windows 11 use the same x64 NSIS installer. The PowerShell entry point locates Git for Windows directly, avoiding the optional WSL `bash` launcher. Native packages must be built on their matching operating systems.

Verified artifacts are staged in the ignored `release-assets/macos`, `release-assets/windows`, or `release-assets/linux` folder. Electron Builder's intermediate root `release/` folder is ignored by Git and removed after successful staging. The macOS script generates a padded, multi-resolution `.icns` file without changing the Windows/Linux `build/icon.png` asset, then stages separate `mac-arm64` and `mac-x64` DMGs.

The macOS release is unsigned by design. The build disables Electron Builder's certificate discovery, verifies the application contents and native architectures, and stages both DMGs without requiring Apple credentials. macOS may show a Gatekeeper warning because the application is not signed or notarized. A maintainer can opt into a signed build explicitly with `OSCODE_REQUIRE_SIGNED=1 bash releaseScripts/macos/build.sh` after configuring Electron Builder's signing credentials.
