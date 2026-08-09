Type: research
Status: resolved
Blocked by: 04

## Question

What exact install, checkpoint-download, device fallback, and compatibility policy should ship for the SAM 2.1 mask-tracking adapter, based on a representative packaged-runtime matrix across Windows, Linux, macOS, CUDA, CPU, MPS, and any currently supported AMD path?

Run bounded compatibility measurements where environments are available; record unsupported cells explicitly rather than extrapolating. Decide dependency isolation, backend/config/checkpoint version validation, default and optional checkpoint tiers, download integrity and storage behavior, capability/error vocabulary, memory downgrade order, cancellation thresholds, and which platform/device combinations are supported, slow, experimental, or unavailable in the first phase. Use the acceptance matrix in the mask-tracking runtime research asset as the starting point.

## Answer

Ship SAM 2.1 video propagation as an optional, process-isolated, release-pinned worker behind the resolved `MaskTracker` protocol. Do not add its stricter Python/PyTorch stack to IOPaint's main environment. Native installs create a private versioned runtime under application data; Docker Compose adds a separate tracking service/profile with CPU and NVIDIA variants, sharing the persistent model and project-data volumes. Runtime upgrades install beside the active version, pass a smoke test before switching, and retain one rollback version.

The compatibility identity is the complete tuple of adapter protocol, backend build, SAM source/version, Python, exact PyTorch/torchvision build and accelerator flavor, config digest, checkpoint SHA-256, and device class. The application validates this tuple before loading and includes it in tracking cache keys. A present image-SAM checkpoint or `.pt` filename never implies video compatibility.

Use SAM 2.1 tiny as the default checkpoint. Small, base-plus, and large are explicit optional quality downloads; changing tiers is never a silent memory fallback. New tracking assets live under `<MODEL_DIR>/tracking/<backend>/<checkpoint-sha256>/`, so native and Docker keep the existing persistent model-cache convention. An application-owned release manifest records URL, size, SHA-256, license, config digest, compatible runtime IDs, and deprecation state. Downloads are explicit, cancellable, resumable where transport allows, written to `.partial`, verified before atomic rename, free-space checked, and importable as offline bundles. Preserve Apache-2.0 notices with the runtime/assets.

The first-phase support matrix is:

- **Supported fast path:** Linux x86-64 NVIDIA CUDA, including the pinned Docker worker; Windows NVIDIA use is through WSL2/Docker, matching upstream's Windows recommendation.
- **Supported slow:** Linux/Windows x86-64 CPU and macOS CPU, tiny by default, with a measured duration warning and confirmation for long spans. Each packaged artifact must pass the release acceptance corpus before it is published as supported.
- **Experimental:** Apple-silicon MPS and Linux AMD ROCm, each with its own runtime lock and the same acceptance corpus; successful PyTorch device discovery is not enough.
- **Unavailable:** native Windows NVIDIA/AMD acceleration, Intel GPU/DirectML, and any unlisted device in phase one. Offer a qualified CPU path where available.

`probe()` returns stable readiness states (`ready-fast`, `ready-slow`, `ready-experimental`) or actionable install, offline, platform, driver, runtime, checkpoint, integrity, disk, memory, worker, cancellation, and staleness codes. Details include detected/required versions, retryability, the affected artifact/device, and safe recovery actions.

For resource exhaustion, first release disposable state, then offload frames, offload inference state, reduce prefetch/commit chunks, offer an explicit smaller-checkpoint restart, and finally offer an explicit CPU restart. Never silently resize canonical frames, shorten the range, change checkpoint, or switch device. Cancellation is checked at every yielded frame/download chunk; acknowledge or heartbeat within 5 seconds, and terminate the isolated worker after 15 seconds without either, retaining only committed checkpoints.

Release qualification records install/smoke results, latency, FPS, host/device peak memory, cancellation, restart/recompute, frame/mask identity, and deterministic regression results for common bounded fixtures. Only the available Windows CPU environment was probed in this investigation (Python 3.12.11, torch 2.9.0+cpu, torchvision 0.24.0+cpu; no SAM 2 video install), so no unmeasured device received an empirical performance claim. Unsupported and untested cells stay explicit rather than inferred.

The full repository audit, platform table, error vocabulary, degradation sequence, measurement corpus, and citations are in [Tracking runtime packaging and compatibility research](../research/tracking-runtime-packaging-and-compatibility.md). The supporting primary-source extraction is in [SAM 2.1 packaging and compatibility source memo](../research/tracking-packaging-source-memo.md), with machine-managed citation ledgers beside both reports.
