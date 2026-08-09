Type: grilling
Status: resolved
Blocked by: 02, 03, 06, 07, 10, 11

## Question

What processing and output contract governs cached source frames, propagated masks, per-frame inpainting, preview fidelity, progress, cancellation, restart recovery, stale-result invalidation, resource exhaustion, codecs, dimensions, frame timing, audio synchronization, and final Edited Video validation?

Resolve through `/grilling`, `/domain-modeling`, and `/codebase-design`, grounded in the earlier media, tracking, project-lifecycle, and operation-composition decisions.

## Answer

### Preview and cache contract

Use two preview levels. Draft Preview is fast and approximate, may use scaled or selectively sampled frames, and is always labeled as such; its pixels are disposable and can never enter an Edited Video. Proof Preview renders selected canonical frames or a chosen short interval with final operation settings and is suitable for required review before export.

Persist canonical frame assets, authored and propagated masks, approved Proof Preview frames, completed final-render frame chunks, and job checkpoints. Model tensors, decoder state, memory banks, Draft Preview pixels, and incomplete chunks are disposable.

Every durable intermediate uses a deterministic cache key containing at least the Source Fingerprint, FrameKey/rational range, canonicalization and decoder build, input asset hashes, Video Operation and approval revisions, composite mask hash, render model/checkpoint/runtime identity, pixel-affecting settings, and output profile version. A changed dependency invalidates only descendants of that key; caches are never accepted by timestamp or filename alone.

### Processing and recovery

A final render plan freezes the current Trim Range, approved Video Operation revisions, canonical frame table, Primary Audio Track selection, toolchain identities, and output profile. Per-frame work always starts from the canonical source frame, composites compatible masks once, and generates immutable verified frame chunks. Metadata and job progress checkpoint through `ProjectStore` only after each asset/chunk is complete.

Cancellation stops at the next atomic frame/chunk boundary, preserves verified chunks and the job checkpoint, and exposes Resume while every frozen dependency still matches. A partial mux is never an Edited Video. Changed inputs invalidate only affected chunks and their downstream mux/validation results.

Preflight disk capacity and estimated GPU/RAM needs. The declared resource fallback ladder preserves requested pixels and settings: reduce batch/chunk size, release disposable caches, retry once, then use a validated CPU path when available. Never silently lower resolution, change models, or alter operation settings. If no compatible path remains, checkpoint safely and report the exact exhausted resource, attempted fallbacks, space needed, and available recovery choices.

Failures are typed and recoverable: stale project/source/operation revision, source relink required, corrupt or undecodable frame, missing model/runtime, worker crash, cancellation timeout, GPU/RAM/disk exhaustion, output permission/collision, encode/mux failure, and validation failure. Retrying resumes only verified revision-compatible work. Existing output files are never silently overwritten.

### Edited Video timing and publication

Preserve canonical source-frame presentation order and exact per-frame rational durations inside the current Trim Range, including variable frame rate. Output H.264/AAC MP4 with display orientation baked into pixels and square-pixel display geometry. Trim and synchronize the Primary Audio Track against the same rational project timeline, encoding AAC when present; video-only inputs remain video-only.

Render and mux into a temporary output. Before publication, ffprobe and decoded-frame validation must establish:

- expected H.264 video and optional AAC Primary Audio Track only;
- exact expected canonical frame count, order, and durations;
- monotonic presentation timestamps and the planned Trim Range duration;
- planned output dimensions, square-pixel geometry, and baked orientation;
- audio start/end alignment and duration against the same project timeline;
- full decodability with no missing/corrupt frames;
- completion against the frozen source, toolchain, output-profile, and approved Video Operation revisions.

Only a validated result is atomically published to the selected final filename and recorded as an Edited Video. Validation failure retains useful checkpoints, quarantines the temporary output for diagnostics according to retention policy, and reports no successful artifact.

### Deep module seam

Place a `MediaPipeline` module between application workflows and decoding, tracking, inpainting, caching, encoding, validation, and worker orchestration. Its external interface has four operations:

- `prepare(projectRevision, renderRequest) -> ProcessingPlan | PreflightFailure`
- `run(processingPlan) -> JobHandle`
- `control(jobHandle, cancel | resume) -> JobState`
- `publish(jobHandle, outputTarget) -> EditedVideo | ValidationFailure`

`JobHandle` exposes one typed state/progress stream rather than backend-specific events. `prepare` owns dependency freezing, compatibility and resource preflight, cache discovery, and work planning. `run` owns stages, checkpoints, retries, fallback policy, and stale-result fencing. `control` owns bounded cancellation and revision-safe resume. `publish` owns encode/mux, validation, collision policy, atomic publication, and project registration.

Canonical decoding, MaskTracker, per-frame inpainter, FFmpeg encoder/prober, resource monitor, and ProjectStore are internal seams with production and fault-injection/test adapters. UI callers never construct FFmpeg commands, inspect model tensors, calculate cache keys, merge masks, or infer success from worker exit codes.
