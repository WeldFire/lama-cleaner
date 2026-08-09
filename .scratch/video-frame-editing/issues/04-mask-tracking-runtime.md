Type: research
Status: resolved
Blocked by:

## Question

What local mask-propagation runtime can meet the required seed-and-correction workflow in this repository, given its existing SAM2 image integration, supported platforms, model licensing and distribution, hardware variability, memory limits, cancellation, resumability, and bidirectional recomputation between mask keyframes?

Inspect the repository and authoritative model/runtime sources. Produce a cited Markdown research asset comparing feasible choices; do not assume the bundled SAM2 internals constitute a working video predictor.

## Answer

Adopt the official SAM 2.1 video predictor as the first mask-propagation backend, isolated behind a repository-owned `MaskTracker` adapter. The repository's current SAM 2 integration is image-only: it bundles `SAM2Base` and `SAM2ImagePredictor`, but not the upstream video predictor or its inference-state lifecycle.

The durable contract is exact frame identities, seed/correction masks, per-frame propagated masks, span progress, and cache/version metadata. Model inference tensors, decoded-frame tensors, embeddings, and memory banks remain disposable. After cancellation or restart, rebuild predictor state from durable keyframes and resume from the last atomically committed frame chunk.

SAM 2.1 directly accepts full-mask prompts and exposes bounded forward/reverse propagation, making it the closest match for correction keyframes and recomputation only between immediate neighbors or Tracking Range boundaries. Each adjacent-keyframe span runs in both directions; the later operation-composition decision must define how directional candidates merge. A correction invalidates only its adjacent spans.

Default to the SAM 2.1 tiny checkpoint, make larger variants explicit quality choices, and capability-probe device/runtime support. NVIDIA CUDA is the initial fast path. CPU is a measured slow fallback; MPS and AMD/ROCm remain experimental until packaged-runtime testing establishes correctness, memory use, and cancellation behavior. Upstream's Python/PyTorch requirements exceed this repository's current floor, so video tracking must be optional and version-validated rather than inferred from the presence of an existing SAM 2 image checkpoint.

Keep XMem as an experimental fallback/benchmark, because it is permissively licensed and memory-conscious but requires more application-owned orchestration. Cutie is a later quality benchmark. Keep ProPainter outside the tracking contract and do not bundle it as the default video inpainting backend: it consumes masks rather than tracks them, has substantial memory demands, and its supplied license is non-commercial-only.

The tracker adapter must expose capability diagnostics, preparation over exact-frame-ordered inputs, seed/correction masks, bounded directional propagation, frame-boundary cancellation/progress, invalidation, deterministic cache keys, and disposal. Packaging must add checksummed downloads, license and disk-space disclosure, cancellation/offline states, and strict backend/config/checkpoint compatibility.

The complete cited comparison, adapter boundary, recomputation algorithm, platform caveats, and acceptance matrix are in [Mask-tracking runtime research](../research/mask-tracking-runtime.md).
