# 27 — Qualify native and Docker project workflows

**What to build:** Verify that the complete Exact Frame Editing project workflow satisfies the same persistence and media contract across supported native platforms and the existing Docker setup.

**Blocked by:** 21 — Qualify exact frames against a real-media fixture corpus; 22 — Automate the Phase 1 browser workflow; 23 — Persist resumable Frame Edit documents; 24 — Relink moved sources and quarantine mismatches; 25 — Fault-test atomic project commits; 26 — Qualify migrations, read-only recovery, and writer leases.

**Status:** claimed

- [ ] Native Windows, native Linux, macOS, and Docker run the project/frame workflow without requiring tracking hardware.
- [ ] Docker service recreation preserves `/data/projects`, project permissions, active project recovery, Frame Edit documents, and relink metadata.
- [ ] Project persistence is independent of model and frontend volume replacement.
- [ ] Paths and project directories remain portable between the frontend, backend, and any process that requires project access.
- [ ] Each platform runs the approved browser workflow and real-media corpus, with unsupported capabilities reported explicitly.
