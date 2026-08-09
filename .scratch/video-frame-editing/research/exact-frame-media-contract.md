# Exact-frame media contract

## Recommendation

Make a pinned FFmpeg software-decoding pipeline authoritative for frame identity and editor pixels. The browser remains the interactive video navigator, but it does not define a Frame Edit's identity and its canvas pixels never become the persisted editing base.

On first use, build a canonical frame table for the selected video stream. `ffprobe` can emit per-frame records with `-show_frames` and constrain fields with `-show_entries`; its output is machine-readable and it supports stream selection.[1] Store integer timestamp values, never decimal seconds alone.

Each row and persisted `FrameKey` should contain:

```text
source_fingerprint
video_stream_index
presentation_ordinal
pts_ticks                 # decoded frame PTS when present
best_effort_pts_ticks     # fallback and diagnostic
duration_ticks            # nullable
stream_time_base_num / stream_time_base_den
project_time_num / project_time_den
canonicalization_version
decoder_build_id
```

`presentation_ordinal` is the zero-based order after sorting decoded frames by presentation timestamp with decode order as the stable tie-breaker. It disambiguates duplicate or missing timestamps. `project_time` is an exact rational offset from the first canonical presented frame, not a binary floating-point number and not the container's unadjusted wall-clock timestamp.

FFmpeg describes `AVFrame.best_effort_timestamp` as a timestamp estimated by decoder heuristics in the stream time base.[4] It is therefore useful as a fallback and diagnostic, but not sufficient by itself as a durable identity. The stored frame table plus pinned decoder build and source fingerprint is the durable identity boundary.

## Selection and reopening protocol

1. While the video is paused or playing, continuously retain the latest `requestVideoFrameCallback` metadata. Its `mediaTime` is the PTS, in seconds, of the frame actually presented on the `currentTime` media timeline; its media-pixel width and height intentionally exclude pixel-aspect-ratio adjustment.[6]
2. When the user chooses **Edit frame**, pause, wait for any pending seek to complete, and wait for the next video-frame callback. Submit `mediaTime` as a navigation hint, not as the FrameKey.
3. Map that hint onto the canonical table's rational presentation intervals. Return the resolved `FrameKey`, canonical PNG, display geometry, source color metadata, and a small neighboring-frame strip so the client can confirm the resolved image is the one intended.
4. Persist the returned key and PNG. Reopening first loads the persisted PNG; regeneration seeks to a point before the target and decodes forward until the exact table row is reached. FFmpeg notes that `-ss` normally seeks to a nearby seek point and discards the intervening segment during accurate transcoding, so a naked `-ss <decimal> -frames:v 1` is not the identity contract.[2]
5. After returning to video, restore the browser playhead to the FrameKey's rational project time, wait for `seeked` and a presented-frame callback, then restore the saved Trim Range. HTML defines `currentTime` as a position in seconds on the media timeline and setting it initiates a seek; it is a playback position, not a frame identifier.[5]

If `requestVideoFrameCallback` is unavailable, exact selection is disabled with a compatibility explanation. A `currentTime`-only fallback may navigate and preview but must not silently create a Frame Edit because it cannot prove which compositor frame the user saw.

## Canonical editor image

Decode in software with the project's pinned FFmpeg build and make every transform explicit:

- select the project's chosen video stream;
- apply the stored display transform (rotation and flips) explicitly rather than depending on implicit defaults; FFmpeg enables autorotation by default during transcoding, so the command must deliberately choose and version this behavior.[2]
- crop to visible pixels, then normalize sample aspect ratio into display dimensions and square pixels; FFmpeg's scale/SAR filters distinguish resizing from SAR tagging.[3]
- convert through an explicit, versioned color pipeline to 8-bit sRGB RGBA for the existing image editor, retaining original primaries, transfer, matrix, range, chroma location, HDR side data, and conversion policy alongside the asset;
- encode a lossless PNG with orientation baked into pixels and no residual rotation requirement.

WebCodecs models coded size, visible rectangle, display size, rotation, flip, timestamp, duration, and color space as distinct frame properties, and rendering applies color conversion, crop, rotation, and flip.[7] That separation is the shape the backend contract must preserve even though the editor consumes a normalized bitmap.

This deliberately defines **same frame** as the same canonical table row and persisted canonical bitmap, not byte-identical pixels from every browser decoder. Browser and FFmpeg output may differ in decoder implementation, hardware path, color conversion, scaling, or metadata interpretation. The canonical PNG is therefore the resumable editing base and must be retained until the Frame Edit is deleted; regeneration is a recovery path whose output hash is checked against the original.

## Boundaries considered

| Boundary | VFR identity | Same image on reopen | Browser portability | Verdict |
|---|---:|---:|---:|---|
| Browser `currentTime` + canvas capture | No; time is not a unique frame key | No | Decode and color path vary | Reject |
| Decimal timestamp + one-frame FFmpeg seek | Partial; rounding and duplicate PTS remain | Not guaranteed | Backend-consistent only | Reject |
| WebCodecs-demuxed browser frame | Strong where codec/demux support exists | Browser/build-dependent | Uneven container/codec availability | Optional future accelerator |
| Canonical FFmpeg frame table + persisted normalized bitmap | Yes, with ordinal tie-break | Yes within stored asset; verified on regeneration | Browser is only a navigator | **Adopt** |

## Explicit failure cases

- No decodable video stream, unsupported codec, encrypted media, or a stream whose frame table cannot be completed: reject before creating a Frame Edit.
- Missing PTS on some frames: use best-effort timestamp plus presentation ordinal, mark the source `timestamp_degraded`, and require neighbor-image confirmation. Missing timestamps on enough frames to prevent a monotonic presentation table: reject exact-frame editing.
- Duplicate or non-monotonic timestamps: retain every decoded row and use the ordinal tie-breaker; do not collapse rows by timestamp.
- Browser callback time cannot be mapped to exactly one canonical interval, or the browser-presented image visibly differs from the returned candidate: require the user to choose among adjacent canonical frames rather than guessing.
- Source fingerprint, selected stream, decoder build, or canonicalization version changes: continue from the persisted PNG when valid, but quarantine regenerated assets and tracking caches until revalidated.
- Rotation/display matrix, SAR, visible crop, or color/HDR metadata is contradictory or unsupported: show the raw metadata and fail canonicalization. Do not silently assume square pixels, zero rotation, limited/full range, SDR, or BT.709.
- A timestamp exceeds safe JavaScript integer precision when expressed in native ticks: transmit ticks and rationals as decimal strings and compare them in integer/rational code.
- Decode errors or corrupt frames: record per-frame decode status. A corrupt target cannot seed a Frame Edit; corruption outside the target can still block tracking/render spans that cross it.

## Required test fixtures

Keep generated fixtures small and deterministic, plus licensed real-world samples for decoder/color edge cases:

1. CFR H.264 MP4 at 24 fps with B-frames and a non-zero stream/container start time.
2. VFR MP4 with alternating frame durations and a repeated timestamp edge case.
3. MOV with 90°, 180°, and mirrored display matrices.
4. Anamorphic MOV or MP4 with non-1:1 SAR and an odd visible crop.
5. VP9 WebM with nanosecond-scale container time base and irregular durations.
6. Files with BT.601 limited-range, BT.709 full-range, and BT.2020/PQ or HLG metadata, including one deliberately untagged file and one contradictory-tag fixture.
7. A file with an audio track beginning before video, and one whose video begins before audio, to verify project-time normalization independently of container start time.
8. Missing-PTS, duplicate-PTS, non-monotonic/corrupt-frame, and multi-video-stream fixtures.
9. The same sources exercised in current Chromium, Firefox, and WebKit where supported, capturing `mediaTime`, `currentTime`, media-pixel dimensions, resolved FrameKey, canonical PNG hash, and reopen hash.
10. A source moved without content changes and a one-byte-modified copy, proving Source Fingerprint relinking and quarantine behavior.

Acceptance requires stable FrameKeys across repeated probes with the pinned toolchain, exact VFR next/previous stepping by table adjacency, correct display orientation and aspect, canonical PNG hash equality on reopen, explicit rejection/quarantine for every declared failure, and browser navigation resolving to the intended canonical neighbor or presenting a choice.

## Consequences for the current code

`VideoTrimTimeline.tsx` currently stores playback and trim positions as JavaScript seconds, steps by `1 / avg_frame_rate`, and treats the browser's `currentTime` as current state. `probe_video` returns only duration and a single average/rate estimate. Those are adequate for coarse trimming, but VFR frame stepping and Frame Edit identity require a new backend-owned frame-table/projection boundary. The existing trim endpoint may continue accepting seconds for export UX, but later frame edit, tracking, and render jobs must reference rational FrameKeys/ranges instead.

## Sources

[1] https://ffmpeg.org/ffprobe.html — ffprobe Documentation
[2] https://ffmpeg.org/ffmpeg.html — FFmpeg Documentation
[3] https://ffmpeg.org/ffmpeg-filters.html — FFmpeg Filters Documentation
[4] https://www.ffmpeg.org/doxygen/trunk/structAVFrame.html — FFmpeg AVFrame Struct Reference
[5] https://html.spec.whatwg.org/multipage/media.html — HTML Standard: Media Elements
[6] https://wicg.github.io/video-rvfc — HTMLVideoElement.requestVideoFrameCallback
[7] https://www.w3.org/TR/webcodecs — WebCodecs
