# Phase 1 browser workflow qualification

## Harness

The browser suite lives in `web_app/tests/frame-editing.spec.mjs` and runs with Playwright against the ordinary application URL. It does not enable a prototype query route. The test supplies deterministic API responses and generates a real four-frame VP9/WebM Trim Input plus a valid PNG frame at runtime, keeping browser state-machine coverage independent of model downloads and media-decoder qualification covered by Ticket 21.

The checked-in Playwright configuration uses one Chromium worker so project lifecycle state and download assertions are deterministic. A system-installed Playwright Chromium can be selected with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; the application URL can be selected with `FRAME_EDIT_E2E_BASE_URL`. The fast browser-state scenarios isolate the API contract with an in-memory route implementation. A separately gated Docker scenario uses the real API, SQLite/project volume, FFmpeg extraction, and application container restart.

## Covered workflows

- Create, rename, refresh, open in a fresh page, return to the selector, continue, and confirm project deletion.
- Navigate canonical previous/next frames; drag a trim handle; select first-frame, last-frame, and short trim boundaries; download the trimmed video.
- Enter image mode, download the canonical frame, draw an edit, and exercise Keep editing, Discard, and Save guard outcomes.
- Verify timeline markers and tray entries address the same frame, reopening/replacing does not duplicate an edit, and deletion requires confirmation.
- Verify focused inputs suppress video navigation, image-only bracket shortcuts do not alter video trim state, and General/Video/Image hotkey tabs expose their respective commands.
- Verify undo remains available across an in-place autosave, then resets after leaving and reopening the Frame Edit.

## Verification

Docker-served frontend state-machine command (service exposed by the existing Compose configuration on port 5174):

```powershell
$env:FRAME_EDIT_E2E_BASE_URL='http://127.0.0.1:5174'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Users\Administrator\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe'
npm.cmd run test:e2e:frame-editing
```

Result on 2026-08-12: **6 passed** against the Docker-served frontend. The final native candidate matrix also runs all six isolated scenarios (the real-Docker scenario remains separately gated).

Real Docker persistence and restart command (this intentionally restarts the Compose `app` service and deletes only the uniquely named project it creates):

```powershell
$env:FRAME_EDIT_E2E_REAL_DOCKER='1'
npx.cmd playwright test --config playwright.config.mjs --grep '@docker'
```

Result on 2026-08-12: **1 passed**. The test creates and renames a project through the browser, saves a Frame Edit using the real API/assets/SQLite store, replaces the model and frontend dependency volumes, force-recreates the application and frontend containers, reloads the browser, verifies source/session/document/mask/relink recovery from the retained project volume, proves that volume remains writable, and confirms project deletion.

Supporting checks:

- `npm.cmd exec tsc -- --noEmit` — passed.
- `npm.cmd run test:frame-session` — 6 passed.
- `node --check playwright.config.mjs` and `node --check tests/frame-editing.spec.mjs` — passed.

## Boundary

The fast suite qualifies browser state transitions and the frontend/backend request contract. The gated Docker scenario qualifies persisted integration and restart recovery against the real stack. Ticket 21 owns independent VFR, geometry, color-routing, stream, audio-offset, and corruption evidence; duplicating those expensive media proofs in every browser test would make failures less local and the browser suite less reliable.
