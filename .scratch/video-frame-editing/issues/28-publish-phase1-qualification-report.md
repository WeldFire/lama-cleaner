# 28 — Publish the Phase 1 qualification report

**What to build:** Publish an evidence-based Phase 1 release gate that combines automated qualification with the completed manual QA record and clearly distinguishes verified, skipped, and assumed results.

**Blocked by:** 20 — Restore the full Python test baseline; 21 — Qualify exact frames against a real-media fixture corpus; 22 — Automate the Phase 1 browser workflow; 23 — Persist resumable Frame Edit documents; 24 — Relink moved sources and quarantine mismatches; 25 — Fault-test atomic project commits; 26 — Qualify migrations, read-only recovery, and writer leases; 27 — Qualify native and Docker project workflows.

**Status:** resolved

- [x] Record exact commands, runtime and dependency versions, platforms, Docker configuration, media-fixture identities, and test results.
- [x] Link automated evidence for every Phase 1 acceptance criterion and identify any remaining limitation or waiver.
- [x] Record the approved manual QA outcomes from the map, preserving PASS versus SKIPPED status exactly.
- [x] Treat the skipped VFR, VP9 WebM, rotated-phone, and audio manual checks as assumed behavior only, never as verified evidence.
- [x] State a clear Phase 1 qualified/not-qualified conclusion and the implications for Phase 2 integration.

Phase 1 is **QUALIFIED for the declared SDR capability matrix**. The complete evidence gate is published as [`phase1-release-qualification.md`](../research/phase1-release-qualification.md), backed by all-green native [run 31619550541](https://github.com/WeldFire/lama-cleaner/actions/runs/31619550541) at tested source candidate `a11149f23f6d39165601ba36ab1de63884855411` plus the recorded Docker qualification.

The report preserves all six manual PASS results and the media-format sweep as **SKIPPED — assumed passed, not verified evidence**. Automated coverage is reported separately. macOS HDR canonical extraction is **NOT QUALIFIED** on the tested Homebrew FFmpeg because `zscale` is unavailable; this is a declared capability exclusion, not a silent waiver. Phase 2 may integrate through exact FrameKeys, persisted documents/masks, fenced ProjectStore revisions, and explicit capability codes, but must create independently revisioned Video Operations rather than implicitly applying standalone Frame Edits to video.
