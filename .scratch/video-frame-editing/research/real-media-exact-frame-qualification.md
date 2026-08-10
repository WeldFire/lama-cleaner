# Real-media exact-frame qualification

Date: 2026-08-09  
Qualification runtime: FFmpeg/FFprobe `git-2020-07-27-16c2ed4` on Windows

## Corpus

The test suite generates its fixtures deterministically from FFmpeg `lavfi` sources at runtime. It does not commit opaque media binaries or compare encoded container bytes.

| Fixture | Contract exercised |
| --- | --- |
| H.264 MP4, 5 fps, B-frames, BT.709 tags | CFR timing, decoded presentation order, SDR metadata |
| H.264 MP4 with irregular selected-frame intervals | VFR rational timing and previous/next ordinal navigation |
| H.264 MOV with repeated presentation timestamps | Duplicate timestamp identity through distinct presentation ordinals |
| Timestamp-less elementary H.264 | Actionable rejection when neither PTS nor best-effort timestamps exist |
| H.264 MP4 shifted two seconds | Non-zero source start normalized to project time zero without losing source ticks |
| Mirrored H.264 MOV with 90-degree display rotation | FFmpeg autorotation and display-normalized geometry |
| Anamorphic VP9 WebM with SAR 2:1 | VP9/WebM decode and square-pixel canonical width |
| 8-bit H.264 MP4 tagged BT.2020/PQ | HDR-tag routing metadata plus deterministic Hable tone-map filter coverage |
| MP4 with two video streams and AAC offset by 200 ms | First-video-stream selection and independent audio timing |
| Invalid MP4 bytes | Actionable API failure and logical removal of the incomplete project |

A separate deterministic unit fixture covers the supported `pts: null` plus valid `best_effort_timestamp` fallback. Duplicate timestamps remain unique because FrameKey identity includes presentation ordinal.

## Golden assertions

- Frame tables are rebuilt twice and compared field-for-field, including FrameKey inputs, rational project time, source color metadata, decoder build, and canonicalization version.
- First, middle, and last frames are extracted twice. Tests compare both canonical PNG hashes and SHA-256 hashes of decoded RGBA pixels, dimensions, and mode. Canonical pixels must also equal a separately invoked raw-RGBA reference decode that does not call the production extraction function.
- VFR project times are reconstructed independently from FFprobe best-effort timestamps and the stream rational time base.
- B-frame presence, repeated timestamps, non-zero source ticks, rotated dimensions, anamorphic display dimensions, SDR/HDR metadata, selected stream index, and audio offset are asserted explicitly.
- The project API extracts and reopens every frame, verifies the persisted canonical PNG content hash, and confirms ordinal navigation covers decoded presentation order. The frontend session reducer separately proves that the selected presentation ordinal survives Video Canvas → image editor → Video Canvas and previous/next transitions; rational timing agreement is qualified at the backend media seam.
- Corrupt input returns HTTP 422 with an actionable exact-index message and is absent from the project list.

## Results

Focused real-media and unit qualification:

```text
C:\ProgramData\miniforge3\python.exe -m pytest iopaint/tests/test_frame_media.py iopaint/tests/test_frame_media_real.py -q --basetemp C:\Users\Administrator\AppData\Local\Temp\pytest-ticket21-reviewed -p no:cacheprovider
```

Result after review hardening: **21 passed in 9.24 seconds.**

Expanded Phase 1 backend qualification:

```text
C:\ProgramData\miniforge3\python.exe -m pytest iopaint/tests/test_project_store.py iopaint/tests/test_frame_media.py iopaint/tests/test_frame_media_real.py iopaint/tests/test_frame_edit_api.py iopaint/tests/test_video.py iopaint/tests/test_video_import.py -q --basetemp C:\Users\Administrator\AppData\Local\Temp\pytest-ticket21-expanded -p no:cacheprovider
```

Result after review hardening: **36 passed in 9.85 seconds.**

Final complete Python suite:

```text
C:\ProgramData\miniforge3\python.exe -m pytest iopaint/tests -q --tb=short --basetemp C:\Users\Administrator\AppData\Local\Temp\pytest-ticket21-final -p no:cacheprovider
```

Result: **81 passed, 59 failed, 167 skipped in 84.25 seconds.** The same 59 model/plugin environment failures classified by ticket 20 remain; this ticket adds no new full-suite failure.

Static verification: Ruff reports `All checks passed!` for the production media module and both exact-frame test modules.

The generated PQ-tagged fixture intentionally qualifies metadata retention and tone-map routing, not high-bit-depth HDR color fidelity. A dedicated color-managed high-bit-depth golden corpus would be needed to qualify perceptual HDR accuracy across decoder builds.
