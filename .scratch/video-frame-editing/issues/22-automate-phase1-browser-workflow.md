# 22 — Automate the Phase 1 browser workflow

**What to build:** Add browser-level regression coverage for the complete Exact Frame Editing workflow users have manually qualified, including persistence and mode-specific interactions.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Cover project creation, selection, rename, refresh recovery, restart recovery, and confirmed deletion.
- [x] Cover exact previous/next frame navigation, draggable Trim Range handles, first/last/short trims, and trimmed-video download.
- [x] Cover entry into image mode, exact-frame handoff, single-frame download, Save/Discard/Keep-editing guards, and return with playhead and Trim Range preserved.
- [x] Cover Frame Edit timeline markers, tray reopen, replacement without duplication, and confirmed deletion.
- [x] Verify General, Image Editing, and Video Editing hotkeys act only in their intended modes and respect keyboard focus.
- [x] Run the workflow in the existing Docker-served application configuration without depending on a development-only prototype route.

## Answer

The Phase 1 workflow now has deterministic Playwright coverage on the ordinary Docker-served application route. Three isolated browser scenarios cover exact-frame/trim/image-edit round trips and all dirty-leave outcomes, timeline/tray replacement and deletion, downloads, and mode-owned keyboard behavior. A fourth gated scenario uses the real API, project volume, canonical extraction, and application-container restart to prove project and Frame Edit recovery rather than simulating persistence. See [the browser qualification record](../research/phase1-browser-workflow.md) for commands, scope, and results.
