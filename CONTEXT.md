# LaMa Cleaner

LaMa Cleaner is a local media-editing application. Its initial video capability lets a user create a shorter saved copy of one input video.

## Language

**Trim Range**:
A single, contiguous interval of an input video defined by a start time and an end time.
_Avoid_: Clip list, segment set

**Trimmed Video**:
The saved video containing exactly the content inside a Trim Range.
_Avoid_: Preview, source video

**Edited Video**:
A new video rendered from a Trim Range after applying tracked erase or inpainting operations frame by frame, while preserving the Primary Audio Track when present. Its Trim Input remains unchanged.
_Avoid_: Trimmed Video, overwritten input, mask export

**Draft Preview**:
A fast, approximate view of a Video Operation produced from scaled or selectively sampled frames for interaction. Its pixels never become part of an Edited Video.
_Avoid_: Final render, proof, export

**Proof Preview**:
A frame or short interval rendered from canonical frames with final operation settings for review before export. It demonstrates final rendering behavior but is not itself the Edited Video.
_Avoid_: Draft Preview, mask overlay, final export

**Primary Audio Track**:
The first decodable audio stream of an input video, preserved in the Trimmed Video as AAC when present.
_Avoid_: Audio mix, alternate audio

**Trim Input**:
One MP4, MOV, or WebM file no larger than 2 GB that contains a decodable video stream.
_Avoid_: Upload, source asset

**Editing Project**:
A persistent local record that references a Trim Input and restores its Trim Range, playhead, Frame Edits, masks, Tracking Ranges, and resumable processing state. If its Trim Input moves or changes, the project remains recoverable through source relinking.
_Avoid_: Browser session, exported video, embedded source copy

**Source Fingerprint**:
A layered identity for a Trim Input based on normalized media properties and sampled content, with full-content verification when identity remains ambiguous. File paths are relocatable hints and are not the Trim Input's identity.
_Avoid_: File path, filename match, modification time

**Video URL Import**:
A backend-mediated retrieval of a remote video into a Trim Input, subject to URL safety checks and the 2 GB limit. An extensionless URL is accepted only after its downloaded content proves to be a decodable video. A minimal HTML page may supply the video through its first video or source element.
_Avoid_: Browser fetch, link preview

**Video URL Import Pending**:
A centered Video Canvas overlay displayed from URL paste until the backend returns a validated Trim Input or an error. Its Cancel action aborts the browser request, hides the overlay, and discards any late result.
_Avoid_: Silent URL paste, toast-only loading state

**Video Canvas**:
The central editing canvas shown for a Trim Input, replacing image editing tools while preserving the surrounding workspace layout.
_Avoid_: Video page, trim workspace

**Frame Edit**:
An editable still image identified by the exact presentation timestamp of its decoded frame in a Trim Input. Its latest rendered image, mask, and necessary tool state form a resumable editing session; undo history remains only while that frame is actively open and is not restored after leaving it or restarting the app. Ordinary video playback continues to show the unchanged Trim Input.
_Avoid_: Extracted frame, replacement frame, temporary image

**Tracking Range**:
An explicit source-timeline interval over which a Frame Edit's mask is propagated through video frames. It defaults to the Trim Range when created but remains independently preserved; only its intersection with the current Trim Range participates in preview and rendering.
_Avoid_: Whole video, implicit trim, tracking duration

**Video Operation**:
An independently revisioned instruction derived from versioned snapshots of an eligible Frame Edit and applied over a Tracking Range when producing an Edited Video. A Frame Edit remains a standalone image edit unless the user deliberately creates a Video Operation from it; later changes to that Frame Edit do not silently mutate the operation.
_Avoid_: Automatic frame replacement, image-only edit, implicit tracking

**Trim Timeline**:
The single Video Canvas control that combines playback seeking with draggable Trim Range boundaries.
_Avoid_: Separate seek bar, dual slider

**Frame Step**:
A one-frame movement of the Video Canvas playhead, using 30 fps until a user-configurable source frame rate is available.
_Avoid_: Arbitrary seek nudge, assumed source metadata

**Handle Drag Preview**:
While a Trim Timeline boundary is dragged, the video preview displays that boundary's proposed timestamp. If the playhead would fall outside the changed Trim Range, it is clamped to the same boundary. Fast movement uses coalesced coarse seeks; after 500 ms without movement, the preview refines to the exact boundary and remains precise. A move of at least 10% of the video duration returns to fast behavior. Release also performs an exact seek before normal playhead-driven preview resumes.
_Avoid_: Stale preview, out-of-range playhead

**Handle Drag Pause**:
Starting a Trim Timeline boundary drag pauses playback. Releasing the handle leaves playback paused.
_Avoid_: Playback that continues while choosing a boundary
