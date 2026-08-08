# LaMa Cleaner

LaMa Cleaner is a local media-editing application. Its initial video capability lets a user create a shorter saved copy of one input video.

## Language

**Trim Range**:
A single, contiguous interval of an input video defined by a start time and an end time.
_Avoid_: Clip list, segment set

**Trimmed Video**:
The saved video containing exactly the content inside a Trim Range.
_Avoid_: Preview, source video

**Primary Audio Track**:
The first decodable audio stream of an input video, preserved in the Trimmed Video as AAC when present.
_Avoid_: Audio mix, alternate audio

**Trim Input**:
One MP4, MOV, or WebM file no larger than 2 GB that contains a decodable video stream.
_Avoid_: Upload, source asset

**Video URL Import**:
A backend-mediated retrieval of a remote video into a Trim Input, subject to URL safety checks and the 2 GB limit. An extensionless URL is accepted only after its downloaded content proves to be a decodable video. A minimal HTML page may supply the video through its first video or source element.
_Avoid_: Browser fetch, link preview

**Video Canvas**:
The central editing canvas shown for a Trim Input, replacing image editing tools while preserving the surrounding workspace layout.
_Avoid_: Video page, trim workspace

**Trim Timeline**:
The single Video Canvas control that combines playback seeking with draggable Trim Range boundaries.
_Avoid_: Separate seek bar, dual slider

**Handle Drag Preview**:
While a Trim Timeline boundary is dragged, the video preview displays that boundary's proposed timestamp. If the playhead would fall outside the changed Trim Range, it is clamped to the same boundary. Fast movement uses coalesced coarse seeks; after 500 ms without movement, the preview refines to the exact boundary and remains precise. A move of at least 10% of the video duration returns to fast behavior. Release also performs an exact seek before normal playhead-driven preview resumes.
_Avoid_: Stale preview, out-of-range playhead

**Handle Drag Pause**:
Starting a Trim Timeline boundary drag pauses playback. Releasing the handle leaves playback paused.
_Avoid_: Playback that continues while choosing a boundary
