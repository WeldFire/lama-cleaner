# Tracking runtime packaging and compatibility

## Decision

Ship SAM 2.1 video tracking as an **optional, versioned worker runtime**, not as imports added to IOPaint's main Python environment. The application talks to that worker through the resolved `MaskTracker` adapter protocol. Native installs create a private, replaceable environment under application data; Docker Compose runs the same worker contract in a separate service/profile and gives it the existing model volume plus project-data access.

This isolation is necessary because the repository advertises Python 3.7+ and `torch>=2.0.0`, while upstream SAM 2 currently requires Python 3.10+, PyTorch 2.5.1+, and torchvision 0.20.1+.[2] Upstream recommends WSL for Windows and says its custom CUDA extension can fail without preventing core use, although some post-processing is then limited.[2][3] The main image editor must therefore continue to work when tracking is absent, incompatible, offline, or disabled.

## Repository baseline

The current repository:

- installs all Python dependencies into one environment through `setup.py` and `requirements.txt`;
- permits Python 3.7+ and declares only `torch>=2.0.0`;
- exposes `cpu`, `cuda`, and `mps`, falling back from unavailable CUDA/MPS to CPU;
- downloads image-segmentation checkpoints into the configured `XDG_CACHE_HOME`/model root and validates them with recorded MD5 values;
- bundles SAM 2 model/image-predictor code but not the upstream video predictor;
- builds its Compose backend from Ubuntu 22.04, Python 3.10, CUDA 12.1, and an unpinned PyTorch CUDA 12.1 wheel, mounts `/models`, and requests NVIDIA GPU passthrough.

A bounded probe of the available Windows base environment on 2026-08-08 found Python 3.12.11, PyTorch 2.9.0+cpu, torchvision 0.24.0+cpu, no CUDA, and no MPS. That proves only that dependency and device probing works locally; no SAM 2 video package/checkpoint was present, so no tracking performance or correctness result is claimed for this machine.

## Install and dependency policy

Define a pinned `tracking-runtime-lock` per release containing Python minor version, SAM 2 source revision/package version, PyTorch and torchvision builds, accelerator family, adapter protocol version, and supported checkpoint/config manifest. Do not resolve `latest` at user install time.

Native installation is an explicit **Install tracking support** action (and equivalent CLI command) that:

1. probes OS, architecture, driver/backend, free disk, and existing model assets;
2. shows runtime/checkpoint sizes, license, selected device, and whether the resulting mode is supported, slow, or experimental;
3. downloads into temporary files with resumable transport where available;
4. verifies SHA-256 before atomic rename;
5. creates or replaces a versioned private environment; and
6. runs a deterministic smoke test before marking the capability ready.

It never mutates the user's base/Conda environment. Upgrade installs beside the active runtime, switches only after the smoke test, and retains one prior runtime for rollback until the next successful launch.

Docker Compose uses a separate `tracking` service selected through a profile. The image pins a compatible PyTorch/CUDA base by digest, contains the worker code but not model weights, requests the NVIDIA device only in the GPU profile, mounts the same persistent `/models` volume read/write for downloads, and mounts `/data/projects` with the ownership needed to commit masks/checkpoints. NVIDIA containers require the host driver plus NVIDIA Container Toolkit configuration; Compose syntax alone does not create GPU capability.[8] Provide a CPU profile without an NVIDIA reservation so Docker remains startable on non-NVIDIA hosts.

## Checkpoints, configuration, and cache

SAM 2 code and checkpoints are Apache-2.0 licensed.[2][4] Keep attribution/license text alongside the installed runtime and show it before the first download.

Use `sam2.1_hiera_tiny` as the default checkpoint and offer small, base-plus, and large as optional quality tiers. Upstream lists 38.9M, 46M, 80.8M, and 224.4M parameters respectively, and explicitly ties SAM 2.1 checkpoints to current model code.[2] Published throughput was measured on an A100 with PyTorch 2.5.1 and CUDA 12.4, so it is not a user-hardware estimate.[2]

Maintain an application-owned signed/release-reviewed manifest with, for each model: stable model ID, source URL, byte size, SHA-256, license ID, exact config digest, accepted backend/runtime IDs, and deprecation state. Existing image-SAM MD5 values may remain for legacy downloads, but every new tracking asset uses SHA-256. Cache assets under `<MODEL_DIR>/tracking/<backend>/<checkpoint-sha256>/`; native and Docker therefore share the existing model-volume convention without confusing image and video compatibility.

Downloads are explicit and cancellable, use `.partial` files, check free space for download plus unpack/install headroom, verify before atomic rename, and never delete a known-good prior asset on a failed update. Offline capability distinguishes `not-installed` from `installed-ready`; no network call is made when all manifest-addressed artifacts are present. A user may import an offline bundle containing the runtime lock, artifacts, hashes, and licenses.

Loading validates the entire tuple `(adapter protocol, backend build, config digest, checkpoint SHA-256, torch/torchvision build, device class)`. A checkpoint file being present is not evidence that it is compatible. Cached propagated masks additionally retain this tuple through the tracker cache key.

## First-phase platform policy

Statuses are product promises, not guesses. A cell becomes **supported** only after its packaged artifact passes install, smoke, bounded propagation, cancellation, restart/recompute, and memory tests in CI or release qualification.

| Host/runtime | Device | Phase-one status | Policy |
|---|---|---:|---|
| Linux x86-64 native | NVIDIA CUDA | Supported fast path | Ship pinned CUDA worker after acceptance matrix passes. |
| Linux x86-64 Docker | NVIDIA CUDA | Supported fast path | Requires compatible host driver and NVIDIA Container Toolkit.[8] |
| Windows 11 x86-64 | WSL2/Docker NVIDIA CUDA | Supported fast path | This follows upstream's strong WSL recommendation for Windows.[2] |
| Linux/Windows x86-64 | CPU | Supported, slow | Tiny only by default; show a measured estimate and require confirmation for long spans. Windows uses the isolated native CPU worker, not native CUDA. |
| macOS Apple silicon | MPS | Experimental | PyTorch exposes MPS when the backend is built and available, but this ticket has no packaged SAM 2 video measurement.[6] Fall back only with explicit consent. |
| macOS | CPU | Supported, slow | Tiny only; qualification is required on the oldest shipped macOS/Python combination. |
| Linux | AMD ROCm | Experimental | Separate ROCm lock/image and release gate; never install a CUDA wheel or claim parity. |
| Windows | AMD GPU/ROCm | Unavailable | No phase-one worker; offer CPU. Do not extrapolate from Linux ROCm documentation. |
| Intel GPU / DirectML | GPU | Unavailable | Offer CPU; no phase-one backend is defined. |

PyTorch's installer treats CUDA and ROCm as Linux accelerator choices and provides CPU/CUDA choices for Windows; macOS uses its own install path.[5] MPS readiness must be checked with both `is_built()` and `is_available()`, and a successful probe does not by itself establish SAM 2 correctness or speed.[6]

## Capability and error vocabulary

`probe()` returns a stable machine-readable state plus details:

- `ready-fast`, `ready-slow`, `ready-experimental`
- `not-installed`, `installing`, `download-required`, `offline-missing`
- `unsupported-os`, `unsupported-architecture`, `unsupported-device`
- `driver-incompatible`, `runtime-incompatible`, `checkpoint-incompatible`
- `integrity-failed`, `insufficient-disk`, `insufficient-memory`
- `worker-start-failed`, `worker-crashed`, `cancelled`, `stale-result`

Each error carries `code`, retryability, detected/required versions, affected artifact/device, and one or more safe actions. The UI must not collapse incompatibility, OOM, network failure, and user cancellation into “tracking failed.”

## Memory degradation, cancellation, and measurements

For a chosen checkpoint, retry resource pressure in this order:

1. release unrelated model memory and disposable tracker state;
2. process the same exact-frame span with frames offloaded to CPU;
3. also offload inference state to CPU;
4. reduce internal decode/prefetch and durable commit chunk sizes;
5. offer an explicit restart with a smaller checkpoint;
6. offer an explicit CPU restart with a measured time warning.

Never silently shorten the Tracking Range, resize canonical frames, change checkpoint, or substitute a device. OOM retries create a new runtime-options/cache identity and preserve the last valid durable checkpoint.

Cancellation is cooperative at every yielded frame and asset-download chunk. The UI enters `cancelling` immediately; the worker must acknowledge or produce a heartbeat within 5 seconds. If it produces neither for 15 seconds, terminate the isolated worker, discard only uncommitted outputs, and restart it on demand. Persisted frame chunks remain resumable. A release cell fails qualification if ordinary frame-boundary cancellation exceeds 5 seconds on the representative bounded test; exceptionally long indivisible kernels must be surfaced as a known slow-cancel limitation, not hidden.

The release acceptance job uses the same fixture and records: exact runtime lock, install result, 30-frame 480p and 120-frame 720p propagation, first-mask latency, sustained FPS, peak host/device memory, cancellation latency, restart from the last committed chunk, mask dimensions/frame identity, and a fixed-output regression digest/tolerance. Run 1080p as a resource-limit characterization, not a universal pass condition. Unsupported/unavailable cells are recorded explicitly. No local GPU, MPS, ROCm, macOS, Linux-container, or SAM 2 video measurements were available in this session, so those cells remain policy classifications pending the required qualification evidence.

## Consequences for the next ticket

The processing/render/recovery contract may now assume a process-isolated tracker, immutable validated model assets, stable capability/error states, frame-boundary checkpoints, and explicit runtime-option cache identities. It must still decide scheduling across extraction, tracking, inpainting, preview, and render; it should not reopen tracker install or device-support policy.

## Sources

[2] https://github.com/facebookresearch/sam2
[3] https://github.com/facebookresearch/sam2/blob/main/INSTALL.md
[4] https://github.com/facebookresearch/sam2/blob/main/LICENSE
[5] https://pytorch.org/get-started/locally
[6] https://docs.pytorch.org/docs/stable/notes/mps.html
[8] https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
