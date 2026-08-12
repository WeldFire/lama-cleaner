# Phase 1 platform qualification

Qualification date: 2026-08-12

## Current evidence

| Target | Evidence | Result |
|---|---|---|
| Native Windows | 102-test ProjectStore/API/real-media/portable-path suite plus five approved browser scenarios | PASS |
| Docker Desktop (Linux container on Windows) | Real Playwright workflow against `http://127.0.0.1:5174`; created a VP9/WebM project and resumable mask, removed/relinked its Trim Input, replaced the model and frontend dependency volumes, recreated both services, then reopened the document and verified its mask bytes, playhead, and relink history | PASS (1 scenario, 27.3 s) |
| Docker volume isolation and permissions | The same named projects volume survived replacement of uniquely named `models` and `frontend_node_modules` volumes; `/data/projects` remained writable after recreation | PASS |
| Native Linux | GitHub Actions matrix is configured to run the real-media, API, portability, and approved browser suites | PENDING — workflow has not run on a Linux host |
| Native macOS | GitHub Actions matrix is configured to run the same qualification | PENDING — workflow has not run on a macOS host |

The native matrix deliberately installs only exact-frame test dependencies and no tracking checkpoints or CUDA runtime. It runs the real-media corpus and approved browser workflow on every configured operating system. Configuration is not passage evidence: Linux and macOS remain pending until their jobs complete, so Ticket 27 stays claimed.

## Commands

```text
C:\ProgramData\miniforge3\python.exe -m pytest iopaint/tests/test_project_store.py iopaint/tests/test_project_workflow_portability.py iopaint/tests/test_frame_edit_api.py iopaint/tests/test_frame_media.py iopaint/tests/test_frame_media_real.py -q
FRAME_EDIT_E2E_REAL_DOCKER=1 FRAME_EDIT_E2E_BASE_URL=http://127.0.0.1:5174 playwright test tests/frame-editing.docker.spec.mjs
docker compose exec -T app sh -lc "test -w /data/projects && stat -c '%U:%G %a %n' /data/projects"
```

Results: native Windows suite 102 passed; isolated browser suite 5 passed; gated real-Docker browser scenario 1 passed after replacing both auxiliary volumes and recreating both services; project-volume write probe and mask-byte comparison passed.
