## Destination

Reach an implementation-ready plan for a local, single-video trimming workflow: choose one MP4, MOV, or WebM input, select one exact Trim Range, and download a Trimmed Video as an MP4 with H.264 video and AAC audio.

## Notes

The existing application is a React/Vite client served by a FastAPI backend and currently supports images only. Preserve the domain language in `CONTEXT.md`; consult `/domain-modeling` for newly resolved terms. The implementation is explicitly out of scope for this map.

## Decisions so far
- [Media preservation boundaries](issues/03-media-preservation-boundaries.md) — Limit Trim Inputs to 2 GB, preserve only the first decodable audio track, and give retryable errors for invalid or failed trims.
- [Trim workspace interaction](issues/02-trim-workspace-interaction.md) — Use a precision panel with preview, one range timeline, editable timestamps, output duration, and a Download MP4 action.

- [Video processing runtime](issues/01-video-processing-runtime.md) — Use FFmpeg/ffprobe subprocess calls, package the binaries in every distribution, and define exactness at decoded frame/audio-sample boundaries.

## Not yet specified

- The acceptance-test matrix, progress reporting, and recoverable failure behavior, once the processing and interaction decisions establish their constraints.
- The precise implementation seams and delivery sequence, once the selected processing approach and user interaction contract are known.

## Out of scope

- Multiple ranges, multi-clip timelines, transitions, filters, or other video editing features beyond one Trim Range.
- Server output-directory saves, publishing, cloud storage, or remote processing.
- Preservation or authoring of subtitles, chapters, and other non-audio/video tracks unless a later in-scope decision requires it for basic input safety.
