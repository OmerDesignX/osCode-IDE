# macOS release assets

The universal `osCode-<version>.zip` supports macOS 12 Monterey and newer and is produced and verified on the macOS GitHub Actions runner. It contains the complete `.app`, native llama.cpp commands for Intel and Apple silicon, and separate uv/Python 3.10, 3.11, and 3.12 trees for both architectures. Model weights are downloaded on demand: Apple silicon receives MLX and Intel receives GGUF. No installer or administrator access is required.

GitHub-sized files end in `.part001`, `.part002`, and so on. Download every part, verify `osCode-macos-SHA256SUMS.txt`, then reassemble in Terminal:

```sh
cat osCode-*.zip.part* > osCode.zip
unzip osCode.zip
```

Run osCode where it is or drag it into Applications. Native construction, signing, and runtime testing must happen on macOS rather than Windows.
