# 27 — Qualify native and Docker project workflows

**What to build:** Verify that the complete Exact Frame Editing project workflow satisfies the same persistence and media contract across supported native platforms and the existing Docker setup.

**Blocked by:** 21 — Qualify exact frames against a real-media fixture corpus; 22 — Automate the Phase 1 browser workflow; 23 — Persist resumable Frame Edit documents; 24 — Relink moved sources and quarantine mismatches; 25 — Fault-test atomic project commits; 26 — Qualify migrations, read-only recovery, and writer leases.

**Status:** resolved

- [x] Native Windows, native Linux, macOS, and Docker run the project/frame workflow without requiring tracking hardware.
- [x] Docker service recreation preserves `/data/projects`, project permissions, active project recovery, Frame Edit documents, and relink metadata.
- [x] Project persistence is independent of model and frontend volume replacement.
- [x] Paths and project directories remain portable between the frontend, backend, and any process that requires project access.
- [x] Each platform runs the approved browser workflow and real-media corpus, with unsupported capabilities reported explicitly.

## Answer

The cross-platform contract is qualified by [GitHub Actions run 31617395494](https://github.com/WeldFire/lama-cleaner/actions/runs/31617395494) at commit `a1c8cc74b9c6d8bc3220330034923ca5a03166a4`: native Windows, Ubuntu, and macOS each completed the 104-case ProjectStore/API/portable-path/real-media suite and all five approved Playwright browser scenarios without tracking models, CUDA, or checkpoints. macOS explicitly skips only HDR canonical PNG extraction because its Homebrew FFmpeg build lacks `zscale`; HDR metadata/routing and the rest of the media corpus still run.

Docker qualification also ran all five approved browser scenarios against the Docker-served frontend and all 21 frame-media/unit/real-media cases inside the `app` container. The gated persistence scenario separately proved a VP9/WebM project through source loss and fingerprint-verified relink, replacement of both model and frontend dependency volumes, recreation of `app` and `frontend` while retaining the projects volume, writable `/data/projects`, byte-identical restored mask data, preserved document/session/relink metadata, edit reopen, and deletion. A portable-project test copies a self-contained project directory between differently rooted stores and verifies adoption and all authored assets through the public ProjectStore interface.

Qualification exposed and fixed three real portability defects: POSIX startup cleanup could delete an actively leased draft; clean Vite development checkouts generated `undefined/api/v1`; and legacy rotation/color fixture tagging varied across FFmpeg releases. The final matrix pins/installs FFmpeg explicitly per runner and fails rather than silently skipping when FFmpeg is absent. Full evidence and commands are recorded in [`phase1-platform-qualification.md`](../research/phase1-platform-qualification.md).
