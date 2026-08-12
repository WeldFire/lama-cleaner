# Phase 1 platform qualification

Qualification date: 2026-08-12

## Current evidence

| Target | Evidence | Result |
|---|---|---|
| Native Windows | GitHub Actions run 31617395494: 104-case ProjectStore/API/real-media/portable-path suite plus five approved browser scenarios | PASS |
| Docker Desktop (Linux container on Windows) | Real Playwright workflow against `http://127.0.0.1:5174`; created a VP9/WebM project and resumable mask, removed/relinked its Trim Input, replaced the model and frontend dependency volumes, recreated both services, then reopened the document and verified its mask bytes, playhead, and relink history | PASS (1 scenario, 27.3 s) |
| Docker volume isolation and permissions | The same named projects volume survived replacement of uniquely named `models` and `frontend_node_modules` volumes; `/data/projects` remained writable after recreation | PASS |
| Docker approved browser and real-media suites | Five approved Playwright scenarios against the Docker-served frontend; 21 frame-media/unit/real-media cases inside `app` | PASS |
| Native Linux | GitHub Actions run 31617395494 on `ubuntu-latest`: backend/real-media and browser steps | PASS |
| Native macOS | GitHub Actions run 31617395494 on `macos-latest`: backend/real-media and browser steps; HDR canonical extraction explicitly skipped because Homebrew FFmpeg lacks `zscale` | PASS with declared unsupported HDR extraction capability |

The native matrix deliberately installs only exact-frame test dependencies and no tracking checkpoints or CUDA runtime. [Run 31617395494](https://github.com/WeldFire/lama-cleaner/actions/runs/31617395494) at commit `a1c8cc74b9c6d8bc3220330034923ca5a03166a4` completed successfully on Windows, Ubuntu, and macOS. All three jobs passed both the backend/real-media step and the five-scenario approved browser workflow. macOS reports the missing `zscale` filter as a narrow unsupported HDR canonical-extraction capability rather than silently treating it as coverage.

## Commands

```text
C:\ProgramData\miniforge3\python.exe -m pytest iopaint/tests/test_project_store.py iopaint/tests/test_project_workflow_portability.py iopaint/tests/test_frame_edit_api.py iopaint/tests/test_frame_media.py iopaint/tests/test_frame_media_real.py -q
FRAME_EDIT_E2E_REAL_DOCKER=1 FRAME_EDIT_E2E_BASE_URL=http://127.0.0.1:5174 playwright test tests/frame-editing.docker.spec.mjs
FRAME_EDIT_E2E_BASE_URL=http://127.0.0.1:5174 playwright test tests/frame-editing.spec.mjs
docker compose exec -T app sh -lc "cd /app && python -m pytest iopaint/tests/test_frame_media.py iopaint/tests/test_frame_media_real.py -q --timeout=120 -p no:cacheprovider"
docker compose exec -T app sh -lc "test -w /data/projects && stat -c '%U:%G %a %n' /data/projects"
```

Results: the 104-case native suite and five browser scenarios passed on Windows, Ubuntu, and macOS in one authoritative run; Docker passed the 21-case media suite and all five approved browser scenarios; the gated real-Docker browser scenario passed after replacing both auxiliary volumes and recreating both services; project-volume write probe and mask-byte comparison passed.
