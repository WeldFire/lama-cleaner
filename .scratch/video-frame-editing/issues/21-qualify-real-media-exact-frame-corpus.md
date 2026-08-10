# 21 — Qualify exact frames against a real-media fixture corpus

**What to build:** Prove that canonical frame identity, extraction, navigation, and round trips remain exact across representative real media rather than only mocked FFmpeg behavior.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Add deterministic generated fixtures for CFR, VFR, duplicate or missing PTS, B-frames, non-zero starts, rotation or mirroring, anamorphic pixels, VP9 WebM, SDR and HDR tags, multiple streams, corruption, and audio offsets.
- [ ] Repeated selection and reopen of every supported fixture yields the same FrameKey and canonical PNG hash.
- [ ] Previous/next navigation and Video Canvas to image editor round trips agree with decoded-frame presentation order and rational timing.
- [ ] Golden assertions compare decoded frames, geometry, color metadata, and timing rather than container bytes.
- [ ] Unsupported or corrupt inputs fail with an actionable error and do not create misleading project state.
