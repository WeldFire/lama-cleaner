Type: wayfinder:map

## Destination

Reach an implementation-ready, phased specification for persistent video frame editing and object removal: move exact video frames into the existing image editor and back without losing video context, propagate correctable mask keyframes over explicit Tracking Ranges, and render an Edited Video while preserving the original Trim Input.

## Notes

This is a planning map; implementation is out of scope. Preserve the language in `CONTEXT.md` and use `/domain-modeling` whenever a term is resolved. Use `/grilling` for product decisions, `/prototype` for interaction questions, `/codebase-design` for module boundaries, and `/grounded-citations` for claims about FFmpeg, browser media APIs, and tracking models.

Standing product decisions from the destination interview:

- A Frame Edit is keyed by an exact decoded-frame presentation timestamp and remains associated with its Trim Input.
- Returning to the Video Canvas preserves the playhead and Trim Range; original video playback stays unchanged and the Trim Timeline marks saved Frame Edits.
- A Frame Edit is resumable with its latest rendered image, mask, and necessary tool state; undo history need not survive an app restart.
- Each Tracking Range defaults to, and remains within, the current Trim Range. Multiple correction Frame Edits act as mask keyframes and only affected spans are recomputed.
- An Editing Project survives app restarts and supports relinking a missing or changed Trim Input.
- The destination artifact is an Edited Video produced by frame-wise erase/inpainting with the Primary Audio Track preserved.

## Decisions so far

- [Workspace round-trip interaction](issues/01-workspace-round-trip-interaction.md) — Keep the Trim Timeline visible across video and image modes and pair it with a persistent, responsive Frame Edit tray; guarded transitions preserve the exact paused frame and Trim Range.
- [Editing Project lifecycle](issues/02-editing-project-lifecycle.md) — Automatically autosave projects by stable actions, identify movable sources with layered fingerprints, quarantine mismatched relinks, use recoverable deletion, and enforce a recoverable single-writer lease.
- [Exact-frame media contract](issues/03-exact-frame-media-contract.md) — Use a pinned FFmpeg canonical frame table and persisted display-normalized bitmap; browser presentation time is only a navigation hint, with explicit ambiguity and metadata failure paths.
- [Mask-tracking runtime](issues/04-mask-tracking-runtime.md) — Put official SAM 2.1 video propagation behind a model-neutral tracker adapter; persist masks and span checkpoints rather than inference tensors, and keep XMem experimental and ProPainter separately licensed.
- [Resumable Frame Edit session](issues/05-resumable-frame-edit-session.md) — Separate global preferences, project defaults, durable serializable Frame Edit documents, and one transient active session behind a deep three-operation module; autosave preserves undo only until the frame is left.
- [Tracking and correction interaction](issues/06-tracking-and-correction-interaction.md) — Make the timeline authoritative for ranges, keyframes, progress, and invalidated spans; pair it with a confidence-assisted review grid and a compact status indicator, with explicit correction/recompute and approval gates.
- [Frame Edits to video operations](issues/07-frame-edits-to-video-operations.md) — Require explicit conversion from standalone Frame Edits to independently revisioned Video Operations; composite compatible erase masks once from canonical frames, surface incompatible overlaps, preserve dormant out-of-trim work, and never invent replacement keyframes.
- [Editing Project storage architecture](issues/10-editing-project-storage-architecture.md) — Use portable project directories with transactional SQLite metadata and content-addressed assets under a dedicated native/Docker data root, protected by asset-before-metadata commits, migrations, fenced leases, logical trash, and a deep four-operation ProjectStore module.
- [Tracking runtime packaging and compatibility](issues/11-tracking-runtime-packaging-and-compatibility.md) — Isolate SAM 2.1 video tracking in pinned native/Docker workers with validated checkpoint bundles, explicit platform capability classes, deterministic memory fallbacks, and bounded cancellation/release gates.
- [Processing, render, and recovery contract](issues/08-processing-render-and-recovery-contract.md) — Separate disposable Draft Previews from canonical Proof Previews, persist revision-keyed chunks/checkpoints, preserve VFR timing and synchronized primary audio, use quality-preserving resource fallbacks, and publish only strictly validated outputs through a deep MediaPipeline module.
- [Implementation-ready phased specification](issues/09-implementation-ready-phased-specification.md) — Deliver Exact Frame Editing, Tracked Video Operations, then Edited Video Delivery, each gated by deep-module contracts, media fixtures, fault injection, browser/Docker coverage, decoded golden assertions, and bounded visual review.

## Not yet specified

None. The route to the destination is fully specified in [`spec.md`](spec.md).

## Out of scope

- General multi-clip editing, transitions, titles, color grading, or a multi-track nonlinear timeline.
- Destructive modification of the Trim Input.
- Cloud project storage, collaborative editing, publishing, or remote processing.
- General-purpose motion tracking unrelated to masks used by the frame-editing and object-removal workflow.
