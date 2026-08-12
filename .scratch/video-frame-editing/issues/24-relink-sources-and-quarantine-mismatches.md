# 24 — Relink moved sources and quarantine mismatches

**What to build:** Let a user recover an Editing Project whose Trim Input moved while preventing edits from silently attaching to a different video.

**Blocked by:** None — can start immediately.

**Status:** claimed

- [ ] A missing Trim Input presents an explicit relink workflow instead of making the project unusable or silently dropping work.
- [ ] A moved copy with a matching Source Fingerprint relinks successfully and preserves FrameKeys, Trim Range, playhead, markers, and Frame Edits.
- [ ] A candidate with a mismatched or ambiguous fingerprint is rejected or quarantines all timestamp-dependent work pending explicit resolution.
- [ ] Relink decisions persist across refresh and restart and are recorded in project metadata.
- [ ] Relinking never destructively modifies the original Trim Input or existing project assets.
