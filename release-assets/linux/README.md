# Linux release assets

Linux releases are produced and verified on the Ubuntu GitHub Actions runner so the terminal and llama.cpp binaries match Linux.

- Install `oscode_<version>_amd64.deb`, or use the Snap package.
- Choose Small, Medium, or Large in AI Coder to download only that GGUF tier into the user's application-data directory.

Large files end in `.part001`, `.part002`, and so on. Download every part for an artifact, verify `osCode-linux-SHA256SUMS.txt`, and reassemble it before installation:

```sh
cat oscode_<version>_amd64.deb.part* > oscode_<version>_amd64.deb
```

Install the DEB with `sudo apt install ./oscode_<version>_amd64.deb`, or install the reconstructed Snap through the normal Snap workflow.
