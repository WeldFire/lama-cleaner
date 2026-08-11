# 23 — Persist resumable Frame Edit documents

**What to build:** Make a saved Frame Edit genuinely resumable after application or container restart by restoring its editable document, not only its flattened rendered image.

**Blocked by:** None — can start immediately.

**Status:** claimed

- [ ] Persist the latest rendered image, editable mask data, canvas geometry, necessary tool settings, and operation snapshot for each Frame Edit.
- [ ] Reopening a Frame Edit after browser refresh, backend restart, and Docker recreation restores equivalent editable pixels and mask alignment.
- [ ] Autosave preserves undo history while the frame remains active; leaving or restarting may intentionally discard undo history without discarding durable document state.
- [ ] Document revisions use atomic project commits and never reference missing assets.
- [ ] Older flattened-only Frame Edits remain viewable and expose a clear, non-destructive compatibility path.
