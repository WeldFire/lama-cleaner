# Python test baseline qualification

Date: 2026-08-09  
Environment: repository-documented `base` conda environment on Windows, Python 3.12

## Dependency decision

The tested compatibility tuple is pinned exactly:

- `diffusers==0.27.2`
- `huggingface_hub==0.25.2`
- `transformers==4.44.2`

The piecemeal-installed base environment contained Transformers 4.57.1 and Hub 0.35.0 despite the requirements file's exact Hub 0.25.2 pin. The open-ended `transformers>=4.44` constraint permits that newer Transformers release, whose Hub requirement conflicts with the Hub version required by Diffusers 0.27.2. Diffusers imports `huggingface_hub.cached_download`, which Hub 0.35.0 no longer exports, so pytest failed during collection. The exact tuple imports successfully and the complete suite collects 288 tests.

## Complete-suite result

Command:

```text
C:\ProgramData\miniforge3\python.exe -m pytest iopaint/tests -q --tb=short --basetemp .scratch/pytest-ticket20-full-escalated -p no:cacheprovider --junitxml=.scratch/video-frame-editing/research/ticket20-full-suite.xml
```

Result: **288 total; 62 passed, 59 failed, 167 skipped, 0 errors in 73.05 seconds.** Pytest reached 100%, wrote the JUnit report, and exited normally with status 1 because failures remain. All failures are accounted for below.

## Exhaustive failure classification

The 59 failures are current environment/fixture qualification results, not regressions introduced by Exact Frame Editing:

| Tests | Count | Classification |
| --- | ---: | --- |
| `test_brushnet` | 1 | Optional Stable Diffusion 1.5 model is not installed; model scan exposes only `lama` and `cv2`. |
| `test_controlnet` | 4 | Optional Diffusers or local checkpoint fixtures are not installed. |
| `test_instruct_pix2pix` | 4 | Optional InstructPix2Pix model is not installed. |
| `test_low_mem` | 2 | Optional Stable Diffusion model fixtures are not installed. |
| `test_model` | 19 | Optional `ldm`, `zits`, `mat`, `fcf`, `manga`, and `migan` model assets are not installed. |
| `test_model_md5` | 1 | Optional `ldm` asset is not installed. |
| `test_model_switch` | 3 | Optional Stable Diffusion inpainting model is not installed. |
| `test_paint_by_example` | 1 | Optional Paint-by-Example model is not installed. |
| `test_sd_model` | 7 | Optional Stable Diffusion/SDXL repositories and local checkpoint fixtures are not installed. |
| `test_sdxl` | 1 | Optional SDXL inpainting model is not installed. |
| `test_plugins` | 15 | Remove-background model downloads are unavailable in this offline run and the plugin exits when its assets cannot be obtained. |
| `test_plugins` | 1 | The Lucida plugin requires the declared `kornia` dependency, which is missing from this existing base environment. |

This classification is exhaustive: 43 unavailable inpainting-model cases + 15 unavailable remove-background download cases + 1 missing declared plugin dependency case = 59 failures. The missing declared `kornia` package is environment drift and therefore a real environment qualification failure; it is not being mislabeled as an optional dependency. The compatibility change restores import and collection so these qualification results are visible. CUDA, MPS, and other unavailable device/model combinations account for the 167 explicit skips. Ticket 27 owns resolution/qualification of supported native and Docker environments.

## Supported workflow smoke evidence

The available CV2 inpainting workflow and image metadata round trips ran after the pin: **16 passed, 48 deselected**. The CV2 cases initialize `ModelManager(name="cv2")` and execute real inference across all existing strategy/algorithm/radius combinations. The focused Phase 1 backend suite is recorded in the ticket answer.

Focused Exact Frame Editing command:

```text
C:\ProgramData\miniforge3\python.exe -m pytest iopaint/tests/test_project_store.py iopaint/tests/test_frame_media.py iopaint/tests/test_frame_edit_api.py iopaint/tests/test_video.py iopaint/tests/test_video_import.py -q --basetemp .scratch/pytest-ticket20-focused -p no:cacheprovider
```

Result: **17 passed in 0.45 seconds.**

The EXIF round-trip tests were also made Windows-safe by replacing a concurrently reopened `NamedTemporaryFile` with pytest's closed `tmp_path` file. This removes the four Windows sharing/ACL failures observed while qualifying the baseline.
