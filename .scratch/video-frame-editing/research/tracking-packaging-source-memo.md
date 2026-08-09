# SAM 2.1 packaging and compatibility: primary-source memo

Research date: 2026-08-08. This memo separates upstream guarantees from proposed product policy; it does not claim that an upstream-supported PyTorch device has been validated with SAM 2.1 in this repository.

## Upstream facts

### SAM 2.1 code, runtime, and platform

- Meta's current SAM 2 repository requires Python 3.10+, PyTorch 2.5.1+, and torchvision 0.20.1+; its package metadata also requires NumPy 1.24.4+, Pillow 9.4+, Hydra 1.3.2+, iopath 0.1.10+, and tqdm 4.66.1+.[1][5]
- The upstream tested/recommended host is Linux. Meta strongly recommends Ubuntu under WSL for Windows instead of claiming native-Windows support.[2]
- The install normally builds a custom CUDA connected-components extension. `SAM2_BUILD_CUDA=0` skips it; failure is non-fatal by default and leaves image/video inference usable, but disables the small-hole/sprinkle post-processing step.[2][5]
- Building that extension requires PyTorch to be installed first plus an `nvcc` CUDA toolkit matching the CUDA version used by PyTorch. Meta warns that mismatched or duplicate PyTorch/CUDA installations can cause load-time symbol failures.[2]
- SAM 2.1 checkpoints require matching newer SAM 2.1 code/configs; Meta explicitly documents state-dict and missing-config failures caused by stale installations.[1][2]
- Meta publishes four SAM 2.1 tiers: Hiera tiny, small, base-plus, and large. The README pairs each checkpoint with its exact `configs/sam2.1/*.yaml` configuration.[1]
- The repository code is Apache-2.0 licensed.[3] Meta's official Hugging Face SAM 2.1 model card also labels the checkpoint Apache-2.0.[9]

### Checkpoint delivery and integrity

- Meta's official download script fetches all four checkpoints from fixed `dl.fbaipublicfiles.com/segment_anything_2/092824/` URLs using `wget` or `curl`.[4]
- The upstream script checks only downloader exit status: it does not publish or verify file sizes, cryptographic digests, signatures, or a signed manifest.[4] Therefore, an app that needs deterministic integrity must maintain its own release-pinned allowlist of URL, byte length, SHA-256 digest, checkpoint ID, compatible config ID, and adapter/code version. This is a product recommendation, not an upstream guarantee.

### PyTorch device/platform envelope

- PyTorch publishes CPU builds on Linux, macOS, and Windows; NVIDIA CUDA builds on Linux and Windows; and AMD ROCm selection on Linux. Its Windows install section discusses CPU and CUDA, not ROCm.[6]
- PyTorch's ROCm build deliberately exposes CUDA-like Python APIs (including `torch.cuda.is_available()`), so runtime capability reporting must use build/runtime metadata rather than interpreting the Python namespace as NVIDIA CUDA.[6][8]
- PyTorch exposes MPS acceleration on supported macOS/Metal systems through the `mps` device. Current documentation says availability depends on an MPS-enabled build, device, and macOS 14+.[7]
- These PyTorch support statements do **not** establish SAM 2.1 parity. SAM 2 upstream documents Linux/CUDA as its recommended environment, gives a CPU escape hatch for its demo, recommends WSL on Windows, and makes no support commitment for MPS or ROCm.[1][2]

## Packaging implications for ticket 11

1. **Isolate tracking dependencies.** Keep SAM 2.1/PyTorch out of the existing app's base dependency solve (separate worker environment or image). Pin a tested SAM 2 commit/release, Python minor, exact PyTorch/torchvision pair, and compute flavor. This avoids SAM's minimum constraints silently replacing the application's existing torch stack.
2. **Ship a known-good Linux matrix first.** Treat Linux NVIDIA CUDA as `supported`; Linux CPU as `supported-slow` after bounded tests. Treat Windows as the existing Docker/WSL Linux path rather than native SAM packaging. Mark native Windows, macOS CPU/MPS, and Linux ROCm `experimental` or `unavailable` until this adapter passes the same acceptance corpus there.
3. **Do not compile at end-user startup.** For CUDA images, build the optional SAM extension in a pinned build stage matching the final PyTorch/CUDA runtime, then run an import/inference smoke test. Provide a no-extension image/path as a documented functional fallback with the post-processing capability reported as absent.
4. **Validate a model bundle, not merely a `.pt` file.** Before loading, require a recognized tuple of checkpoint ID + SHA-256 + byte length + SAM config ID + adapter compatibility version. Reject unknown or partial files; download to a temporary path, stream-hash, fsync, then atomically publish into a shared model cache.
5. **Make downloads explicit and recoverable.** Do not bundle every tier. A reasonable default is Hiera small, with tiny as the memory/speed downgrade and base-plus/large as optional quality downloads. The exact default still requires repository-specific performance/quality measurements.
6. **Probe capabilities at runtime.** Report backend (`cpu`, `cuda`, `mps`, `rocm`), device name, total/free memory where available, torch/vision/SAM versions, extension/post-processing availability, checkpoint/config compatibility, and a tiny predictor smoke-test result. Installation support and successful device discovery are weaker than successful adapter inference.
7. **Use an explicit fallback order.** On CUDA out-of-memory, release caches and retry the same tier with conservative settings before suggesting a smaller checkpoint; move to CPU only with user-visible consent because video propagation may become extremely slow. Do not silently switch device or checkpoint mid-operation because it compromises reproducibility and scheduling estimates.
8. **Keep errors actionable.** Distinguish at least: `runtime_unavailable`, `device_unavailable`, `device_unsupported`, `checkpoint_missing`, `checkpoint_download_failed`, `checkpoint_integrity_failed`, `bundle_incompatible`, `insufficient_memory`, `extension_unavailable`, and `inference_failed`. Include the detected compatibility tuple and a safe recovery action without leaking local paths unnecessarily.

## Evidence gaps that measurements must close

- No primary Meta source found that promises production support or result parity for SAM 2.1 video propagation on native Windows, macOS/MPS, or ROCm.
- No official cryptographic digest/signature was found in Meta's checkpoint download path. Release engineering must obtain and pin hashes from the exact artifacts it tests.
- Primary documentation gives no reliable minimum VRAM/RAM, cancellation latency, throughput, or maximum practical frame-range figures for this application's workloads. These must come from the ticket's bounded test corpus and should not be extrapolated between checkpoint tiers/devices.
- The optional CUDA extension changes post-processing availability, so extension-on/off needs a parity/quality cell even though Meta says the effect should be limited in most cases.[2]

## Sources

[1] https://github.com/facebookresearch/sam2/blob/main/README.md
[2] https://github.com/facebookresearch/sam2/blob/main/INSTALL.md
[3] https://github.com/facebookresearch/sam2/blob/main/LICENSE
[4] https://raw.githubusercontent.com/facebookresearch/sam2/main/checkpoints/download_ckpts.sh
[5] https://raw.githubusercontent.com/facebookresearch/sam2/main/setup.py
[6] https://pytorch.org/get-started/locally
[7] https://docs.pytorch.org/docs/stable/notes/mps.html
[8] https://docs.pytorch.org/docs/stable/notes/hip.html
[9] https://huggingface.co/facebook/sam2.1-hiera-small
