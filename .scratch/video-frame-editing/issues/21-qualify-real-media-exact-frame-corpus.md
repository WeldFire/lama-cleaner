# 21 — Qualify exact frames against a real-media fixture corpus

**What to build:** Prove that canonical frame identity, extraction, navigation, and round trips remain exact across representative real media rather than only mocked FFmpeg behavior.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Add deterministic generated fixtures for CFR, VFR, duplicate or missing PTS, B-frames, non-zero starts, rotation or mirroring, anamorphic pixels, VP9 WebM, SDR and HDR tags, multiple streams, corruption, and audio offsets.
- [x] Repeated selection and reopen of every supported fixture yields the same FrameKey and canonical PNG hash.
- [x] Previous/next navigation and Video Canvas to image editor round trips agree with decoded-frame presentation order and rational timing.
- [x] Golden assertions compare decoded frames, geometry, color metadata, and timing rather than container bytes.
- [x] Unsupported or corrupt inputs fail with an actionable error and do not create misleading project state.

## Answer

Added a deterministic, generated real-media corpus covering the complete timing, codec, geometry, color, stream, audio, and failure matrix. Qualification compares rebuilt frame tables, independently reconstructed rational presentation timing, decoded RGBA pixel hashes, display geometry, and source color metadata rather than encoded container bytes.

The corpus exposed and fixed explicit-null PTS fallback: a frame with `pts: null` now uses its valid best-effort presentation timestamp. Invalid FFprobe JSON and unusable stream time bases now become actionable `FrameMediaError` failures. The PQ-tagged fixture routes through a versioned deterministic Hable tone-map pipeline into BT.709 editing pixels while its source color metadata remains attached to each frame; it qualifies routing, not high-bit-depth HDR fidelity.

Project-level round trips reopen every canonical frame, retain its persisted PNG content hash, follow presentation ordinals exactly, and reject corrupt uploads with HTTP 422 while logically removing the incomplete project. Full commands, fixture definitions, and results are recorded in the [real-media exact-frame qualification](../research/real-media-exact-frame-qualification.md).

Verification after review hardening: 21/21 exact-frame media tests, 36/36 expanded Phase 1 backend tests, and all five frontend frame-session tests pass. The complete suite finishes with 81 passed, the same 59 ticket-20 environment failures, and 167 skips.
