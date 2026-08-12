# 23 — Persist resumable Frame Edit documents

**What to build:** Make a saved Frame Edit genuinely resumable after application or container restart by restoring its editable document, not only its flattened rendered image.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Persist the latest rendered image, editable mask data, canvas geometry, necessary tool settings, and operation snapshot for each Frame Edit.
- [x] Reopening a Frame Edit after browser refresh, backend restart, and Docker recreation restores equivalent editable pixels and mask alignment.
- [x] Autosave preserves undo history while the frame remains active; leaving or restarting may intentionally discard undo history without discarding durable document state.
- [x] Document revisions use atomic project commits and never reference missing assets.
- [x] Older flattened-only Frame Edits remain viewable and expose a clear, non-destructive compatibility path.

## Answer

Frame Edits now persist a versioned document beside an atomic rendered PNG and canvas-aligned composite mask. The document records its canonical rational FrameKey, revision, canonical-image reference, canvas/crop geometry, brush commands and settings, and operation/model snapshot. The backend rejects missing masks, mismatched FrameKeys, and stale revisions before committing assets and metadata together.

While image mode remains active, a snapshot-aware serialized autosave persists changed documents without resetting the editor store or its undo/redo history. Reopen restores the authoritative composite mask, geometry, brush settings, operation parameters, and available model. Malformed or pre-v2 edits safely fall back to a labeled legacy render; saving one creates a new resumable edit rather than overwriting the legacy record.

Verification: 9 focused backend API/store tests, 6 Frame Edit session tests, TypeScript, focused ESLint, and the relevant Playwright trim/edit workflow pass. The browser lifecycle/reload scenario also verifies document/mask upload and mask retrieval after reload; the existing gated Docker restart scenario remains the container persistence qualification seam.
