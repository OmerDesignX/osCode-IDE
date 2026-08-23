# Windows release assets

The x64 NSIS package supports Windows 10 and newer on 64-bit Intel and AMD computers. The assisted installer runs per user and does not require a machine-wide installation.

The installer includes the editor, MinGit, Python 3.10/3.11/3.12, uv, llama.cpp, and the local Windows Computer Control helper. Computer Control uses Windows UI Automation first and takes over the visible foreground pointer only when an application requires real input. It installs no driver or server, starts disabled for each project, requires an osCode permission grant, blocks terminals/security controls, and can be stopped with Escape. Optional Microsoft helper telemetry is forcibly disabled by osCode.

CUDA support uses a compatible NVIDIA runtime installed on the target PC when it validates successfully. The installer includes osCode's llama.cpp CUDA 12.4 and CUDA 13.3 backend adapters but does not copy NVIDIA `cudart`, `cublas`, or `cublasLt` runtime DLLs. osCode checks `CUDA_PATH`, versioned CUDA environment variables, standard NVIDIA Toolkit folders, and `PATH` at runtime. On NVIDIA systems with driver 525 or newer, the user can explicitly add the checksum-pinned official CUDA 12.4 runtime to osCode's private application-data directory. If CUDA is unavailable, Vulkan still accelerates compatible GPUs through the installed display driver, followed by CPU.

Model weights are not embedded. In AI Coder, choose Small, Medium, or Large to download only that GGUF tier into `%APPDATA%\osCode\models`. osCode verifies every shard and shows cancellable progress in the top bar.

Verify downloads with `osCode-windows-SHA256SUMS.txt`.

This development build is not code-signed. Configure a trusted publisher certificate before presenting it as a final public release.
