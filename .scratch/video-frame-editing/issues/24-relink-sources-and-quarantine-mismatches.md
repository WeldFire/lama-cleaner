# 24 — Relink moved sources and quarantine mismatches

**What to build:** Let a user recover an Editing Project whose Trim Input moved while preventing edits from silently attaching to a different video.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] A missing Trim Input presents an explicit relink workflow instead of making the project unusable or silently dropping work.
- [x] A moved copy with a matching Source Fingerprint relinks successfully and preserves FrameKeys, Trim Range, playhead, markers, and Frame Edits.
- [x] A candidate with a mismatched or ambiguous fingerprint is rejected or quarantines all timestamp-dependent work pending explicit resolution.
- [x] Relink decisions persist across refresh and restart and are recorded in project metadata.
- [x] Relinking never destructively modifies the original Trim Input or existing project assets.

## Answer

Projects whose owned Trim Input asset is missing now return a typed `source_relink_required` condition. The project selector responds with an explicit relink chooser and explains that nonmatching media leaves all frame-based work quarantined. Other HTTP conflicts cannot accidentally activate this workflow.

Source Fingerprint v2 combines normalized probe properties, three sampled-content hashes, file size, and a full SHA-256 ambiguity resolver. Candidates are independently probed. Exact matches are ingested as new immutable assets, and the relink decision is audited in project metadata; mismatches are rejected and audited without changing the source, FrameKeys, session, or Frame Edits. Legacy SHA-256 projects accept byte-identical sources and atomically migrate their source plus all dependent FrameKeys to v2 while retaining cached canonical PNG references.

Verification covers missing sources, mismatch quarantine, audit persistence, legacy migration, FrameKey/Frame Edit/session preservation, successful source recovery, and the browser chooser flow. Seventeen focused backend tests, TypeScript, focused ESLint, and the relink Playwright scenario pass.
