# 22 — Automate the Phase 1 browser workflow

**What to build:** Add browser-level regression coverage for the complete Exact Frame Editing workflow users have manually qualified, including persistence and mode-specific interactions.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Cover project creation, selection, rename, refresh recovery, restart recovery, and confirmed deletion.
- [ ] Cover exact previous/next frame navigation, draggable Trim Range handles, first/last/short trims, and trimmed-video download.
- [ ] Cover entry into image mode, exact-frame handoff, single-frame download, Save/Discard/Keep-editing guards, and return with playhead and Trim Range preserved.
- [ ] Cover Frame Edit timeline markers, tray reopen, replacement without duplication, and confirmed deletion.
- [ ] Verify General, Image Editing, and Video Editing hotkeys act only in their intended modes and respect keyboard focus.
- [ ] Run the workflow in the existing Docker-served application configuration without depending on a development-only prototype route.
