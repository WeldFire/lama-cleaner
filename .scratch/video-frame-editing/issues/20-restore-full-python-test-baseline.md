# 20 — Restore the full Python test baseline

**What to build:** Restore a compatible Python dependency baseline so the repository's complete existing test suite can collect and run, giving Phase 1 qualification a trustworthy regression signal instead of relying only on focused tests.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Resolve the incompatibility where the installed `diffusers` expects the removed `huggingface_hub.cached_download` API without breaking supported application workflows.
- [ ] The complete Python test suite collects without dependency-import errors in the documented base environment.
- [ ] The complete Python test suite runs to completion, with any remaining failures triaged as product failures or explicitly documented pre-existing failures.
- [ ] Focused Phase 1 backend tests remain green under the restored dependency baseline.
