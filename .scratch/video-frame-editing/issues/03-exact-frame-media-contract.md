Type: research
Status: resolved
Blocked by:

## Question

Which media contract can reliably identify, extract, display, and later reopen the exact decoded frame the user selected across constant- and variable-frame-rate MP4, MOV, and WebM inputs, including rotation, pixel aspect ratio, color metadata, timestamp normalization, and browser-versus-FFmpeg decode differences?

Inspect the current code and authoritative FFmpeg/browser documentation. Produce a cited Markdown research asset comparing viable boundaries and recommend one contract with explicit failure cases and test fixtures.

## Answer

Adopt a backend-authoritative, pinned FFmpeg media contract. Build and persist a canonical frame table for the selected video stream, storing integer timestamp ticks and time base, exact rational project time, presentation ordinal, source fingerprint, canonicalization version, and decoder build. Timestamp alone is not unique enough: the ordinal is the tie-breaker for duplicate or missing timestamps, while FFmpeg's best-effort timestamp is fallback/diagnostic data rather than sole identity.

The browser remains a navigator. `requestVideoFrameCallback().mediaTime` identifies the compositor-presented frame closely enough to resolve a candidate against the backend table, but it is only a hint. `currentTime` and average-FPS stepping must never become Frame Edit identity. If the callback is unavailable or mapping is ambiguous, exact selection is unavailable or the user chooses among neighboring canonical frames; the app must not guess.

The editor receives and persists a lossless, display-oriented, square-pixel, explicitly color-converted sRGB PNG produced by the canonical pipeline. Rotation/flip, crop, SAR, and color/HDR handling are versioned and explicit. Original media metadata remains attached. Reopening loads the stored PNG; regeneration decodes forward to the exact table row and verifies its hash. Thus “same frame” means the same canonical row and stored editor bitmap, not assumed pixel equality between browser and FFmpeg decoders.

Explicit degraded/rejection behavior covers missing, duplicate, or non-monotonic PTS; ambiguous browser mapping; changed sources/toolchains; contradictory orientation/SAR/color metadata; unsafe JavaScript integer ranges; decode corruption; unsupported/encrypted media; and incomplete frame tables. The acceptance suite must include CFR and VFR sources, B-frames, non-zero starts, duplicate/missing timestamps, rotated/mirrored MOV, anamorphic and cropped video, VP9 WebM, SDR/HDR and contradictory color tags, audio/video start offsets, corruption, multiple video streams, cross-browser mapping, and relink/quarantine cases.

The complete cited comparison, protocol, failure policy, fixtures, and current-code gap analysis are in [Exact-frame media contract](../research/exact-frame-media-contract.md).
