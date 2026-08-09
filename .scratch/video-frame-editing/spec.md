# Persistent Video Frame Editing and Tracked Object Removal

Status: implementation-ready planning specification

## Product outcome

A user can load a Trim Input, select the exact frame currently presented, edit it with the existing image tools, and return to the Video Canvas without losing the playhead or Trim Range. Frame Edits persist in an Editing Project and can be reopened. Eligible mask-based Frame Edits can explicitly become tracked Video Operations with correction keyframes. Approved operations can be composed into a validated Edited Video while the Trim Input remains unchanged.

The canonical vocabulary is defined in [`CONTEXT.md`](../../CONTEXT.md). The Wayfinder map and linked resolution tickets are the authoritative rationale for this specification.

## Goals

- Exact, reproducible frame identity for CFR and VFR video.
- A reversible Video↔Image workflow using existing image-editing capabilities.
- Durable, resumable projects that work natively and in the existing Docker setup.
- Correctable local mask propagation with explicit capability and fallback behavior.
- Reproducible Video Operations whose revisions do not silently follow mutable image state.
- Frame-accurate, audio-synchronized, validated Edited Video output.
- Crash-safe autosave, cancellation, resume, migration, relinking, and recovery.

## Non-goals

- Multi-clip or multi-track nonlinear editing, transitions, titles, or color grading.
- Arbitrary temporal animation of every image-editing tool.
- Implicit single-frame replacement in video.
- Destructive modification of Trim Inputs.
- Cloud storage, collaboration, publishing, or remote processing.
- General-purpose tracking unrelated to masks used by Video Operations.

## Authoritative contracts

| Area | Contract |
| --- | --- |
| Workspace | [Workspace round-trip interaction](issues/01-workspace-round-trip-interaction.md) |
| Project lifecycle | [Editing Project lifecycle](issues/02-editing-project-lifecycle.md) |
| Frame identity | [Exact-frame media contract](issues/03-exact-frame-media-contract.md) and [research](research/exact-frame-media-contract.md) |
| Tracking runtime | [Mask-tracking runtime](issues/04-mask-tracking-runtime.md) and [research](research/mask-tracking-runtime.md) |
| Editor state seam | [Resumable Frame Edit session](issues/05-resumable-frame-edit-session.md) |
| Tracking UX | [Tracking and correction interaction](issues/06-tracking-and-correction-interaction.md) |
| Operation composition | [Frame Edits to video operations](issues/07-frame-edits-to-video-operations.md) |
| Media processing/output | [Processing, render, and recovery contract](issues/08-processing-render-and-recovery-contract.md) |
| Project storage | [Editing Project storage architecture](issues/10-editing-project-storage-architecture.md) |
| Tracking packaging | [Tracking runtime packaging and compatibility](issues/11-tracking-runtime-packaging-and-compatibility.md) and [research](research/tracking-runtime-packaging-and-compatibility.md) |

## Phase 1 — Exact Frame Editing

### User capability

The user can load a supported video, preserve and adjust its Trim Range, select the exact displayed frame, enter the normal image editor, save or discard work, return paused at the same exact frame, and reopen or delete multiple timestamp-marked Frame Edits from a persistent tray. Projects autosave and survive restart, move/relink, read-only conflicts, and recoverable deletion.

### Required implementation seams

- Backend-owned canonical frame table and canonical PNG extraction.
- `FrameEditSession` with `open`, `dispatch`, and `leave`.
- `ProjectStore` with `open`, `transact`, `lifecycle`, and `close`.
- The existing Zustand editor state becomes a hydrated view of one active session, not durable truth.

### Storage and Docker

- Native default: platform application-data project root.
- Docker: `PROJECT_DATA_DIR=/data/projects` on a dedicated persistent Compose volume shared with processes that require project access.
- Portable project directory with SQLite metadata, manifest, content-addressed immutable assets, disposable cache, and temp area.
- Asset-before-metadata atomic commits, transactional migrations, hash validation, fenced writer lease, logical trash, and read-only recovery.

### Phase 1 acceptance

- Repeated selection/reopen yields the same FrameKey and canonical PNG hash.
- Exact next/previous and round-trip behavior passes CFR, VFR, duplicate/missing PTS, B-frame, non-zero-start, rotated/mirrored, anamorphic, VP9 WebM, SDR/HDR-tagged, multi-stream, corrupt, and audio-offset fixtures.
- Entering image mode pauses; returning preserves the exact frame and Trim Range.
- Dirty Save/Discard/Keep-editing guards cover return and frame switching.
- Saved render, editable mask data, geometry, and operation snapshot survive restart; undo survives autosave only while the frame remains active.
- Source moves relink by Source Fingerprint; mismatches quarantine timestamp-dependent work.
- Crash at every asset/transaction/manifest boundary leaves either the prior revision or the complete new revision, never metadata pointing to a missing asset.
- Lease takeover fences the prior writer; older/newer schemas follow migration/read-only rules.
- Project state persists across Docker container recreation and model/frontend volume changes.
- Native Windows, native Linux, macOS, and Docker pass project/frame workflows without tracking hardware.

## Phase 2 — Tracked Video Operations

### User capability

A saved mask-based Frame Edit can explicitly create a Video Operation. The user sets a Tracking Range on the timeline, propagates the seed mask, cancels/resumes work, reviews time-ordered sampled frames, adds correction mask keyframes in image mode, sees adjacent invalidated spans, recomputes only stale spans, and approves a revision.

### Runtime and packaging

- Official SAM 2.1 video predictor behind the repository-owned `MaskTracker` interface.
- Isolated, release-pinned worker; do not upgrade the main application's older Python/PyTorch environment to satisfy SAM 2.1.
- Tiny checkpoint default; other tiers are explicit verified downloads.
- Full compatibility tuple and SHA-256-verified release manifest participate in cache identity.
- Docker adds an optional tracking worker/profile sharing model and project volumes.
- Supported fast: qualified Linux x86-64 NVIDIA CUDA, including Docker/WSL2 path.
- Supported slow: release-qualified Windows/Linux x86-64 CPU and macOS CPU.
- Experimental: separately qualified MPS and ROCm. Other accelerators are unavailable unless later qualified.

### Tracking semantics

- Durable inputs/results are exact FrameKeys, authored masks, propagated masks, span checkpoints, and version metadata; inference tensors remain disposable.
- Adjacent keyframe spans propagate in bounded forward and reverse directions.
- Correction changes invalidate only adjacent spans.
- Removing a correction merges and stales neighboring spans; removing the sole seed blocks until explicit replacement.
- Tracking Range persists independently of Trim Range; only their intersection is active.
- Confidence prioritizes review but never auto-approves or mutates masks.

### Phase 2 acceptance

- Mask/frame identity remains exact across propagation, cancellation, worker restart, and project restart.
- Cancel is acknowledged/heartbeated within the qualified threshold and force-terminates a stuck isolated worker without losing committed spans.
- Correction invalidates exactly the two adjacent spans or range boundary equivalents.
- Review grid covers the range and surfaces low-confidence, discontinuity, decode-error, and correction-adjacent samples.
- Approval is impossible with stale/incomplete/error spans and is revoked by dependency changes.
- Missing/offline/corrupt/incompatible runtime and checkpoint states produce actionable capability codes.
- Resource fallbacks never silently resize frames, shorten ranges, change checkpoint, or switch device.
- Docker CPU and NVIDIA profiles persist downloads/checkpoints and pass restart/cancellation fixtures.
- Every platform labeled supported passes the published release-qualification corpus; experimental/unavailable states remain explicit.

## Phase 3 — Edited Video Delivery

### User capability

The user can combine approved compatible erase operations, inspect Draft and Proof Previews, resolve incompatible overlaps, render with resumable progress, and receive an Edited Video only after strict automated validation.

### Composition and rendering

- Standalone Frame Edits never affect video implicitly.
- Video Operations own versioned seed/correction/setting snapshots independent of source Frame Edit lifetime.
- Compatible overlapping masks composite per canonical source frame and inpaint once from original pixels.
- Incompatible overlaps block with an explicit unify-settings or separate-ranges resolution.
- Draft Preview is approximate and disposable; Proof Preview uses canonical inputs and final settings.
- `MediaPipeline` exposes `prepare`, `run`, `control`, and `publish`.
- Persist verified canonical assets, masks, Proof frames, final frame chunks, and checkpoints under complete revision-derived keys.
- Preserve canonical VFR presentation order/durations. Output H.264/AAC MP4 with baked orientation, square pixels, and Primary Audio Track synchronized on the rational project timeline.

### Publication and recovery

- Preflight disk and memory; reduce batches/chunks, release caches, retry once, and use an explicit validated CPU path without altering requested pixels/settings.
- Cancellation stops at atomic boundaries and resumes only when frozen dependencies match.
- Render/mux to temporary output; never expose partial files as Edited Videos.
- Validate streams/codecs, frame count/order/durations, monotonic timestamps, dimensions/orientation, Trim Range duration, audio alignment, full decodability, and frozen revision identities.
- Publish atomically only after validation; never overwrite an existing output silently.

### Phase 3 acceptance

- Compatible-mask composition is order-independent and runs one inpaint pass per canonical frame.
- Incompatible settings always block rather than silently layer.
- Draft pixels are provably absent from final cache ancestry and output.
- Cancel/restart resumes verified chunks; changed revisions invalidate only affected descendants.
- Disk-full, OOM, worker death, stale revision, permission collision, encode failure, and validation failure leave a recoverable project with no false success artifact.
- Golden decoded outputs preserve expected CFR/VFR frame timing, orientation, dimensions, and audio synchronization.
- ffprobe and full decode validation reject deliberately truncated, timestamp-corrupt, codec-wrong, audio-drifted, stale-revision, and missing-frame outputs.
- Native/Docker outputs satisfy the same media contract for every declared supported runtime.

## Cross-phase verification requirements

- Contract tests exercise only the public interfaces of `FrameEditSession`, `ProjectStore`, `MaskTracker`, and `MediaPipeline`.
- Internal adapters support deterministic clocks, temporary filesystems/SQLite, fake workers, resource probes, and fault injection.
- Browser tests cover keyboard/focus accessibility, persistent timeline/tray, exact-frame handoff, dirty guards, range/keyframe markers, review/correction, status, cancellation, and approval.
- Generated fixtures cover media timing/geometry/color/audio/corruption cases; golden assertions operate on decoded frames, masks, and rational timing rather than container bytes.
- Failure injection covers crashes between every atomic step, stale revisions, lease takeover, migrations, disk/memory exhaustion, worker death, cancellation, resume, and output validation.
- Docker tests recreate services and volumes, verify `/data/projects` persistence/permissions, exercise CPU and NVIDIA profiles where available, and prove frontend/backend/tracking-worker path portability.
- A small licensed manual corpus gates visual tracking/inpainting quality where pixel equality is not meaningful. Results record checkpoint/runtime identity, hardware, span, corrections, latency, and reviewer outcome.

## Delivery constraints

- Each phase must meet its acceptance gates before the next phase depends on it; later work may begin behind internal seams but cannot weaken earlier contracts.
- No phase may introduce decimal-seconds-only frame identity, browser-captured canonical pixels, session-only project truth, live mutable operation references, silent quality/device fallback, or unvalidated final publication.
- Prototype files created during planning are throwaway primary-source artifacts. Production implementations must be rewritten to the contracts above and must not promote prototype code directly.
- Implementation-ticket creation is intentionally outside this Wayfinder map.
