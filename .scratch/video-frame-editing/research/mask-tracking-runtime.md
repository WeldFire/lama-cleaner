# Mask-tracking runtime research

## Decision

Use the official **SAM 2.1 video predictor** as the first mask-propagation backend, behind a repository-owned `MaskTracker` adapter. The adapter—not SAM 2's in-memory inference state—is the product contract. Persist exact frame identities, correction masks, propagated masks, and span checkpoints; rebuild model state after restart.

Keep **XMem** as an experimental benchmark/fallback, not as a co-equal phase-one backend. Do not couple tracking to **ProPainter**: it is a video-inpainting consumer rather than a tracker and its supplied license restricts use to non-commercial purposes.[2][8]

## Repository fit

The repository already downloads the SAM 2 and SAM 2.1 tiny/small/base/large checkpoints and embeds Meta-derived model building code. However, `iopaint/plugins/interactive_seg.py` constructs `SAM2ImagePredictor`, and the bundled `segment_anything2` package contains no `SAM2VideoPredictor`. The current integration therefore supplies static-image masks only; it cannot be promoted into a video tracker merely by retaining `SAM2Base` between calls.

The application already supports PyTorch devices `cpu`, `cuda`, and `mps`, with runtime fallback to CPU (`iopaint/runtime.py`), but interactive segmentation is documented/configured around CUDA or CPU. Its broad `torch>=2.0.0` requirement is also below current upstream SAM 2's supported floor. The video runtime must consequently be an optional, capability-probed component rather than silently assumed available on every existing installation.

## Feasible choices

### SAM 2.1 video predictor — selected

The official predictor accepts point/box prompts or a full mask, keeps per-video interaction state, and propagates masks through the video.[1][4] Its propagation API accepts a start frame, maximum frame count, and `reverse`, which directly supports bounded forward and backward recomputation between correction keyframes.[4] The implementation distinguishes a first conditioning frame from a correction on an already tracked frame and can clear nearby stale non-conditioning memory after corrections.[4]

This is the closest semantic match to the product contract: an editor-produced mask can enter through `add_new_mask`, and a span can be recalculated in either temporal direction without tracking the entire Trim Range.[4] The newer predictor also supports independent per-object inference and adding objects after tracking starts.[1]

SAM 2 code and checkpoints are Apache-2.0 licensed.[1] Current upstream installation requires Python 3.10+, PyTorch 2.5.1+, and torchvision 0.20.1+; it recommends WSL for Windows and treats its custom CUDA extension as optional except for some post-processing.[1] This is a real packaging delta from this repository and must be validated rather than hidden.

Upstream offers 38.9M, 46M, 80.8M, and 224.4M parameter SAM 2.1 checkpoints. Its published 91.2–39.5 FPS numbers were measured on an A100 with CUDA 12.4 and cannot be treated as expectations for user hardware.[1] Default to `sam2.1_hiera_tiny` for compatibility and make larger checkpoints an explicit quality/capability choice after local benchmarking.

The predictor can offload decoded frames and inference state to CPU; upstream says frame offload saves GPU memory with small overhead, while state offload trades speed for memory.[4] Those controls make degradation possible, but do not establish acceptable CPU or MPS performance. MPS is a genuine PyTorch device backend,[6] yet upstream SAM 2's documented video path and benchmarks are CUDA-centric.[1] CPU and MPS therefore require capability tests and honest runtime estimates; neither should be promised as interactive before measurement.

### XMem — fallback benchmark

XMem is MIT-licensed and designed for long videos with bounded GPU memory; its repository reports hardware-dependent performance around 20 FPS and handling videos above 10,000 frames.[3] Its `InferenceCore.step` accepts a new mask on a frame, so correction masks are representable.[5]

However, XMem exposes a lower-level sequential memory processor. The application would own frame decoding, object-label conventions, state reset/reseed, bounded forward/backward orchestration, and correction-span invalidation.[5] It is useful as a benchmark or fallback if SAM 2 proves incompatible on a supported runtime, but choosing it first would create more application-specific tracking machinery and would not reuse the repository's existing SAM 2 model family.

### Cutie — not phase one

Cutie is an XMem successor whose maintainers describe better consistency, robustness, and speed, plus interactive permanent-memory tooling.[7] Its documented quick start is CUDA-oriented and tested only on Ubuntu.[7] It is attractive for later quality benchmarking, but its integration surface and platform story are less aligned with this repository than SAM 2's explicit mask-prompt and bidirectional-span API.

### ProPainter — separate optional inpainting adapter

ProPainter consumes a video and frame-wise masks to produce inpainted video; it is not a mask tracker.[2] Its official memory table reports roughly 19 GB for 50 720p frames in fp16, with chunking and resizing offered as memory controls.[2] More importantly, its S-Lab License permits redistribution and use only for non-commercial purposes unless separate permission is obtained.[8] It must not become the default shipped render backend without an explicit product/legal decision. Tracking output should remain a model-neutral mask sequence so video inpainting can be selected independently.

## Required adapter contract

The repository-owned tracker boundary should expose:

- `probe()` returning backend/version/checkpoint/device support, estimated mode (`interactive`, `slow`, or unavailable), and actionable incompatibility reasons.
- `prepare(spanFrames, options)` with decoded frames supplied in exact presentation-timestamp order; upstream directory/JPEG conventions must not leak into project state.
- `setKeyframe(objectId, frameIdentity, mask)` for seed and correction masks.
- `propagate(objectId, from, to, direction, cancellationToken)` yielding per-frame masks and progress at safe frame boundaries.
- `invalidate(objectId, span)` and deterministic cache keys over source fingerprint, exact frame list, keyframe masks, backend/code/checkpoint versions, and runtime options.
- `dispose()` so cancellation or project switching releases GPU/CPU state.

The durable boundary is the keyframe and output-mask graph. SAM 2 inference tensors, decoded-frame tensors, embeddings, and memory banks are disposable caches. A process restart resumes from the last committed mask checkpoint, rebuilds predictor state from durable keyframes, and recomputes only the incomplete span.

## Correction and recomputation algorithm

For adjacent keyframes `K0 < K1`, run a forward pass from `K0` bounded at `K1`, then a reverse pass from `K1` bounded at `K0`. Keep both directional candidates until the operation-composition contract chooses a deterministic merge rule; never let either pass escape the adjacent-keyframe span. At a Tracking Range boundary with only one neighboring keyframe, run only outward from that keyframe.

Adding, changing, or deleting keyframe `K` invalidates only the spans between `K` and its immediate surviving neighbors or Tracking Range boundaries. Cancellation is cooperative between yielded frames: commit masks atomically in small chunks, record the last completed exact frame identity and direction, then discard live predictor state. This yields resumability without attempting to serialize an unstable third-party inference-state schema.

## Packaging and compatibility consequences

SAM 2 video support should be an optional install/download with explicit checkpoint checksum, license metadata, free-space check, progress, cancellation, and offline error states. Loading must validate the backend code/config/checkpoint tuple; the repository's existing image-SAM2 checkpoint alone does not prove video compatibility.

The first supported fast path should be NVIDIA CUDA. CPU should be allowed as a slow fallback only after bounded-span tests establish that it completes without exhausting memory; MPS and AMD/ROCm should remain capability-probed/experimental until tested in the project's packaged environments. Model downgrade should reduce checkpoint size or offload state, never silently reduce frame identity precision or tracking range correctness.

## Acceptance evidence needed before implementation commitment

Run a small compatibility matrix on Windows native packaging, Windows WSL if it remains a supported execution route, Linux CUDA, Linux CPU, and macOS MPS. For each, record installation success, peak host/GPU memory, first-result latency, sustained FPS, cancellation latency, and restart/recompute behavior on representative short/long and 480p/720p/1080p spans. Compare SAM 2.1 tiny against XMem and optionally Cutie on occlusion, reappearance, thin structures, and correction-keyframe convergence.

The implementation specification may commit to the adapter and durable boundaries now. It must not promise real-time tracking, universal platform acceleration, or a bundled video-inpainting model until those measurements and licensing decisions exist.

## Sources

[1] https://github.com/facebookresearch/sam2 — SAM2
[2] https://github.com/sczhou/ProPainter — ProPainter
[3] https://github.com/hkchengrex/XMem — XMem
[4] https://github.com/facebookresearch/sam2/blob/main/sam2/sam2_video_predictor.py — SAM2VideoPredictor
[5] https://github.com/hkchengrex/XMem/blob/main/inference/inference_core.py — XMemCore
[6] https://docs.pytorch.org/docs/stable/notes/mps.html — PyTorchMPS
[7] https://github.com/hkchengrex/Cutie/blob/main/README.md — Cutie
[8] https://github.com/sczhou/ProPainter/blob/main/LICENSE — ProPainterLicense
