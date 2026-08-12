# Phase 1 — Exact Frame Editing release qualification

Qualification date: 2026-08-12  
Tested source candidate: `a11149f23f6d39165601ba36ab1de63884855411`

Native matrix: [GitHub Actions run 31619550541](https://github.com/WeldFire/lama-cleaner/actions/runs/31619550541)

Conclusion: **QUALIFIED for the declared Phase 1 SDR capability matrix; macOS HDR canonical extraction is NOT QUALIFIED on the tested runtime.**

## Release decision

Phase 1 meets its automated SDR acceptance gates on native Windows, Ubuntu, macOS, and the existing Docker setup. HDR extraction passes on qualified Windows/Linux FFmpeg builds but is unavailable on the tested macOS Homebrew build because it lacks `zscale`; that capability is excluded rather than waived. The user-completed manual checks retain their exact PASS/SKIPPED status. Phase 2 may integrate only through the frozen Phase 1 project, FrameKey, document, and mask seams; it must not reinterpret a standalone Frame Edit as a video operation or weaken Phase 1 recovery/media contracts.

This conclusion does not qualify Phase 2 tracking, Phase 3 video rendering, high-bit-depth HDR perceptual fidelity, optional model/plugin workflows missing from the local base environment, or the skipped manual media-format sweep.

## Platforms, runtimes, and configuration

| Target | Runtime/dependencies | Result |
| --- | --- | --- |
| Native Windows (local) | Windows 11; Python 3.12.11; FastAPI 0.115.0; Starlette 0.38.6; HTTPX 0.27.2; Pillow 12.1.1; NumPy 1.26.4; FFmpeg `git-2020-07-27-16c2ed4` | Focused and manual evidence PASS |
| Native Windows (CI) | `win25-vs2026` image `20260803.193.1`; Windows build 26100; Python 3.10.11; Node 20.20.2; npm 10.8.2; Playwright 1.55.0/Chromium build 1187; FFmpeg `n7.1.5-12-g1fdbca85aa-20260812`; FastAPI 0.141.1; Starlette 1.6.0; HTTPX 0.28.1; Pillow 12.3.0; NumPy 2.2.6; pytest 9.1.1 | Backend/real-media and six browser scenarios PASS |
| Native Ubuntu (CI) | `ubuntu24` image `20260720.247.2`; Linux 6.17 Azure/glibc 2.39; Python 3.10.20; Node 20.20.2; npm 10.8.2; Playwright 1.55.0/Chromium build 1187; FFmpeg 6.1.1; same Python packages as Windows | Backend/real-media and six browser scenarios PASS |
| Native macOS (CI) | `macos26` image `20260728.0273.1`; macOS 26.5.2 arm64; Python 3.10.11; Node 20.20.2; npm 10.8.2; Playwright 1.55.0/Chromium build 1187; FFmpeg 8.1.2; same Python packages as Windows | Backend/real-media and six browser scenarios PASS; HDR canonical extraction SKIPPED as unsupported because the build has no `zscale` |
| Docker Desktop Linux container | Docker Desktop 4.85.0; Engine 29.6.2/API 1.55; Compose 5.3.1; WSL2 Linux 6.18.33.2; app image `sha256:dd2d17409141860db6a0d4185489d4926960926f9a6551b077f25680010106ce`; frontend image `sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0`; Compose config SHA-256 `ab5a9d6c7d3233843dad4c708a78002e68e36f4cb8e4ba0be41c8fadaf019217`; Python 3.10.12; Node 20.20.2/npm 10.8.2; FastAPI 0.108.0; Starlette 0.32.0.post1; HTTPX 0.27.2; Pillow 9.5.0; NumPy 1.26.4; FFmpeg 4.4.2 | 21 media cases, six approved browser scenarios, and gated persistence scenario PASS |

The application compatibility tuple remains `diffusers==0.27.2`, `transformers==4.44.2`, and `huggingface_hub==0.25.2`. `httpx<0.28` is pinned because FastAPI 0.108.0/Starlette 0.32 still uses the removed TestClient `app=` shortcut. The existing Compose configuration mounts `PROJECT_DATA_DIR=/data/projects` on the dedicated `projects` volume and keeps `models` and `frontend_node_modules` independent. The Docker qualification replaces both auxiliary volumes, recreates `app` and `frontend`, and restores the normal mounts afterward. Full machine-readable native inventories are retained as `Phase 1 qualification inventory` annotations on each job in run 31619550541.

## Media corpus identities

Fixtures are generated at runtime from deterministic FFmpeg `lavfi` recipes in [`test_frame_media_real.py`](../../../iopaint/tests/test_frame_media_real.py); no media binaries are committed. The release identity is the fixture source at tested candidate `a11149f23f6d39165601ba36ab1de63884855411`, the runtime FFmpeg build recorded in each FrameKey, and canonicalization version `ffmpeg-display-srgb-v2`.

The corpus covers H.264 CFR with B-frames/BT.709, irregular VFR, duplicate timestamps, timestamp-less elementary H.264, non-zero start, mirrored/rotated H.264 MOV, anamorphic VP9 WebM, BT.2020/PQ-tagged H.264, two video streams with offset AAC audio, and corrupt MP4 bytes. Assertions compare rational timing, frame-table identity, canonical PNG hashes, independently decoded RGBA pixels, geometry, color metadata/routing, stream selection, and actionable failures—not encoded container bytes.

## Acceptance evidence

| Phase 1 criterion | Evidence | Result |
| --- | --- | --- |
| Repeated selection/reopen preserves FrameKey and canonical PNG | Real-media first/middle/last repeat extraction plus API reopen tests | PASS |
| CFR/VFR, duplicate/missing PTS, B-frame, non-zero start, rotation/mirror, anamorphic, VP9, SDR/HDR tags, multistream, corruption, audio offset | 104-case native matrix on all three OSes; 21 media cases inside Docker | PASS, except macOS HDR extraction explicitly unsupported |
| Video→image pauses; return preserves exact frame and Trim Range | Approved browser workflow and user manual trim/marker checks | PASS |
| Dirty Save/Discard/Keep Editing guards cover return/switching | Browser workflow navigation state-machine cases | PASS |
| Render, editable mask, geometry, operation snapshot survive restart; undo survives autosave only while active | Browser document reopen and undo lifecycle scenario; Docker mask-byte/document/session recreation scenario | PASS |
| Source relink and mismatch quarantine | API tests and approved browser relink scenario; real Docker relink before recreation | PASS |
| Atomic crash boundaries yield prior or complete new revision | Deterministic ProjectStore creation/asset/metadata/catalog/manifest/cleanup fault matrix | PASS |
| Lease fencing and schema migration/read-only behavior | Concurrent acquisition/takeover, heartbeat, migration backup, hash audit, recovery tests across native matrix | PASS |
| Docker persistence survives service and auxiliary-volume recreation | Gated Docker scenario replaces model/frontend volumes while retaining writable projects volume | PASS |
| Native Windows/Linux/macOS/Docker workflows require no tracking hardware | Native run 31619550541 and Docker suites install no tracking model/checkpoint/CUDA dependency | PASS |

## Exact commands and results

Native matrix (each of Windows, Ubuntu, and macOS):

```text
python -m pytest iopaint/tests/test_project_store.py iopaint/tests/test_project_workflow_portability.py iopaint/tests/test_frame_edit_api.py iopaint/tests/test_frame_media.py iopaint/tests/test_frame_media_real.py -q --timeout=120
npx playwright test tests/frame-editing.spec.mjs --config playwright.config.mjs
```

Result: all three jobs succeeded in run 31619550541 at source candidate `a11149f23f6d39165601ba36ab1de63884855411`. The suite contains 104 collected backend/media cases and six browser scenarios. macOS records one capability skip for HDR canonical extraction without `zscale`.

Docker:

```text
docker compose exec -T app sh -lc "cd /app && python -m pytest iopaint/tests/test_frame_media.py iopaint/tests/test_frame_media_real.py -q --timeout=120 -p no:cacheprovider"
$env:FRAME_EDIT_E2E_BASE_URL='http://127.0.0.1:5174'
.\node_modules\.bin\playwright.cmd test tests/frame-editing.spec.mjs --config playwright.config.mjs
$env:FRAME_EDIT_E2E_REAL_DOCKER='1'
.\node_modules\.bin\playwright.cmd test tests/frame-editing.docker.spec.mjs --config playwright.config.mjs
```

Result: 21 media cases PASS; six approved browser scenarios PASS; one gated persistence/relink/volume-replacement scenario PASS. The HTTPX compatibility pin was verified in the actual running container.

Complete local Python baseline:

```text
C:\ProgramData\miniforge3\python.exe -m pytest iopaint/tests -q --tb=short --basetemp .scratch/pytest-ticket20-full-escalated -p no:cacheprovider
```

Result: 288 total; 62 passed, 59 failed, 167 skipped, 0 collection errors. The 59 failures are exhaustively classified in [`python-test-baseline.md`](python-test-baseline.md): 43 unavailable optional inpainting-model fixtures, 15 unavailable remove-background downloads, and one missing declared `kornia` package in that existing base environment. Supported CV2 real inference and Exact Frame Editing remained green. These are environment limitations, not evidence for those optional workflows.

## Manual QA record

The approved record is reproduced without upgrading assumptions into evidence:

- **PASS** — Rename an Editing Project, refresh/restart Docker, and confirm the name persists.
- **PASS** — Verify each Hotkeys tab and confirm shortcuts do not cross modes.
- **PASS** — Download an edited single frame and confirm its pixels.
- **PASS** — Reopen several timeline markers and Frame Edit tray entries.
- **PASS** — Delete Editing Projects and Frame Edits through their confirmation flows.
- **PASS** — Confirm trims at the first frame, last frame, and a very short range.
- **SKIPPED — assumed passed, not verified evidence** — Exercise a VFR video, VP9 WebM video, rotated phone video, and video with audio.

The automated generated-media corpus covers those skipped formats technically, but it does not retroactively convert the skipped human visual check into a manual PASS.

## Limitations and Phase 2 implications

- macOS Homebrew FFmpeg lacks `zscale`; HDR-tag metadata/routing runs, but HDR canonical extraction is **NOT QUALIFIED** on that runtime. No lower-quality conversion is substituted.
- The PQ fixture is 8-bit tagged content. It qualifies metadata and deterministic tone-map routing, not high-bit-depth or perceptual HDR fidelity.
- Optional image models/plugins absent from the existing local base environment remain unqualified as recorded above.
- Frame Edits remain standalone images and do not alter Trimmed Video output. Phase 2 must create an explicit, independently revisioned Video Operation from an eligible mask-based Frame Edit.
- Phase 2 must consume exact FrameKeys, persisted editable masks/documents, fenced ProjectStore revisions, and the published runtime capability model. It may add tracking assets and spans, but cannot make tracking hardware a prerequisite for reopening or using Phase 1 projects.
