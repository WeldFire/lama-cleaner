Type: research
Status: resolved

## Question

Which video-processing runtime and packaging approach can the FastAPI backend use to produce exact-boundary MP4 (H.264/AAC) Trimmed Videos from MP4, MOV, and WebM inputs across the application's supported local-installation environments?

## Comments

Created while charting the Video Trim map.

## Answer

Use FFmpeg and ffprobe through Python subprocess calls; package the binaries as an explicit application dependency. Validate and probe each upload, transcode the selected range with libx264 and aac, re-probe the result, and return it as a FastAPI download. The output timing is exact to decoded frame and audio-sample boundaries. See [runtime research](../research/video-processing-runtime.md).
