# Lazy Editing Project persistence

Newly selected Trim Inputs still require backend indexing and canonical extraction before a user saves work, but that preparation does not make them durable Editing Projects.

The catalog now distinguishes a hidden draft from a durable project with `activated_at`. New projects begin as drafts, remain addressable by their current browser session, and are excluded from the project selector. The first `save_frame_edit` transaction writes authoritative activation metadata alongside the Frame Edit; the catalog cache is then updated and reconciles from that metadata after an interrupted update. Existing catalog rows are migrated as active to preserve compatibility.

The frontend stores an active-project recovery key and refreshes Recent Projects only after the backend reports a durable project. Leaving or unloading an unedited draft asks the backend to discard it only if it is still a draft. Promotion and conditional discard share a per-project lock and consult authoritative project metadata, preventing stale cleanup from deleting a concurrently promoted project. Explicit draft exits and backend startup physically remove abandoned draft assets. Canonical frame extraction, Trimmed Video download, and trim controls do not activate a draft.

Video Canvas also exposes a native volume range control and **Save Frame**, which downloads the selected backend-owned canonical PNG without entering image mode or creating a Frame Edit.

Verification on 2026-08-11:

- Project store/API tests: 9 passed, including paused-promotion/concurrent-discard and restart-reconciliation boundaries.
- Playwright isolated browser scenarios: 4 passed, 1 gated Docker scenario skipped by default.
- Real Docker persistence/restart scenario: 1 passed.
- TypeScript, targeted ESLint, five frame-session tests, and two video-hotkey tests passed.
