# 20 — Restore the full Python test baseline

**What to build:** Restore a compatible Python dependency baseline so the repository's complete existing test suite can collect and run, giving Phase 1 qualification a trustworthy regression signal instead of relying only on focused tests.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] Resolve the incompatibility where the installed `diffusers` expects the removed `huggingface_hub.cached_download` API without breaking supported application workflows.
- [x] The complete Python test suite collects without dependency-import errors in the documented base environment.
- [x] The complete Python test suite runs to completion, with any remaining failures triaged as product failures or explicitly documented pre-existing failures.
- [x] Focused Phase 1 backend tests remain green under the restored dependency baseline.

## Answer

Pinned the exact tested compatibility tuple: `diffusers==0.27.2`, `huggingface_hub==0.25.2`, and `transformers==4.44.2`. The piecemeal-installed base environment had drifted to Transformers 4.57.1 and Hub 0.35.0; that Hub release removed `cached_download`, which Diffusers 0.27.2 imports during collection. A clean resolver would instead report the old open-ended Transformers constraint and exact Hub pin as incompatible.

Validation in the documented base Python environment:

- Exact package imports succeed and the complete suite collects all 288 tests without dependency-import errors.
- The complete suite reaches 100%: **62 passed, 59 failed, 167 skipped, 0 errors**. Every current environment qualification failure is classified in the [Python test baseline qualification](../research/python-test-baseline.md): 43 reference unavailable optional model assets, 15 reference offline remove-background downloads, and 1 identifies required-dependency drift because declared `kornia` is absent from the base environment.
- The installed CV2 model executes real inference across the existing test matrix: 16 workflow/metadata tests pass.
- The focused Exact Frame Editing backend suite remains green.
- Four Windows EXIF round-trip failures discovered during qualification were fixed by using pytest's closed temporary path instead of reopening a live `NamedTemporaryFile`.

The remaining model/plugin failures are explicitly retained as current environment qualification results rather than hidden or mistaken for Phase 1 regressions. Ticket 27 owns supported native/Docker dependency and capability qualification.
