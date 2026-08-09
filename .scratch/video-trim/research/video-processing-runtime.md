# Video-processing runtime research

## Recommendation

Use the existing FastAPI backend to invoke a bundled-or-required **FFmpeg**
toolchain (`ffmpeg` plus `ffprobe`) with Python's standard-library
`subprocess` module. Do not add a Python video wrapper for the first release.
FFmpeg is the runtime that can decode all agreed input containers (MP4, MOV,
and WebM) and explicitly encode the required MP4/H.264/AAC output. A wrapper
would still need to choose, discover, and package the same codec runtime.

The product contract should say “exact to decoded frame/audio-sample
boundaries,” rather than promise arbitrary sub-frame timing. FFmpeg's accurate
seeking documentation guarantees that, when transcoding, the segment between
the seek point and requested start is decoded and discarded; it does not turn a
video into continuous-time media. [FFmpeg `-ss` and accurate seeking](https://ffmpeg.org/ffmpeg.html#Main-options)

## Processing contract

1. Store the upload in a request-specific temporary directory; never pass its
   name through a shell. Use `subprocess.run([...], check=True, timeout=...)`.
   Python documents that `run()` accepts an argument sequence, supports a
   timeout, and raises `CalledProcessError` when `check=True` fails. [Python
   subprocess documentation](https://docs.python.org/3/library/subprocess.html#subprocess.run)
2. Probe with `ffprobe -v error -show_format -show_streams -of json INPUT`.
   Reject a file without a video stream, malformed/non-finite duration, or a
   trim range outside the probed duration. `ffprobe` documents JSON output,
   format/stream sections, and selective `show_entries` output. [ffprobe
   options](https://ffmpeg.org/ffprobe.html#Main-options)
3. Validate `0 <= start < end <= duration`, calculate `duration = end - start`,
   then transcode with this deterministic command shape:

   ```text
   ffmpeg -y -ss START -i INPUT -t DURATION \
     -map 0:v:0 -map 0:a? -c:v libx264 -c:a aac \
     -movflags +faststart OUTPUT.mp4
   ```

   Input-scoped `-ss` plus transcoding uses accurate seeking by default;
   `-t` limits the output duration. `-t` and `-to` are mutually exclusive, so
   calculate the range duration rather than treating an absolute end time as a
   duration. Mapping and encoder options make the first video stream and an
   optional audio stream explicit; `?` makes the mapped audio optional.
   [FFmpeg option scope, seeking, duration, stream selection, and codec
   examples](https://ffmpeg.org/ffmpeg.html#Description)
4. Re-probe the generated file before returning it. Require one H.264 video
   stream, optionally one AAC audio stream, MP4 container metadata, a duration
   within an explicit frame/sample tolerance of `end - start`, and a non-empty
   file. Return it as a download and clean the request directory after the
   response completes (FastAPI supports post-response `BackgroundTasks`).
   [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/)

`libx264` is build-dependent: startup should run `ffmpeg -hide_banner
-encoders` and fail the trim endpoint clearly if `libx264` or `aac` is absent.
FFmpeg's documentation explains that selecting an encoder requires that the
build provide it. [FFmpeg codec selection](https://ffmpeg.org/ffmpeg.html#Main-options)

## Packaging recommendation

Package FFmpeg as a first-class application dependency, not an accidental
host prerequisite:

| Distribution path | Required change | Rationale |
| --- | --- | --- |
| Docker CPU/GPU/development images | Keep/install `ffmpeg` and add a CI startup check for the `libx264` and `aac` encoders. | All three current Dockerfiles already install the `ffmpeg` OS package; this needs verification rather than a new runtime. |
| Windows one-click installer | Add the `ffmpeg` package to `scripts/environment.yaml` from its existing `conda-forge` channel, then verify the packed environment exposes both executables and encoders. | The installer creates and packs this Conda environment; including the binary there avoids relying on a Windows PATH installation. |
| `pip` / source local installs | Document FFmpeg as a required OS dependency and perform the same startup capability check. | `requirements.txt` has no native video runtime and a Python wheel cannot reliably assert an H.264 encoder in the user's external FFmpeg build. |

Before distributing the Windows package, confirm the selected FFmpeg build's
licensing and notices. FFmpeg documents that enabling GPL components changes
the resulting binary's licensing; `libx264` is commonly one such component.
[FFmpeg legal considerations](https://ffmpeg.org/legal.html)

## Why this fits the current backend

The app already owns a FastAPI process (`iopaint/cli.py` constructs it and
`iopaint/api.py` registers endpoints), accepts `UploadFile`, serves file
responses, and uses an application `output_dir` only for optional image saving.
The trim endpoint can therefore accept multipart video + range, transcode in a
temporary directory, and return `FileResponse` without coupling the first
release to the image file manager or server output directory. Docker is already
covered by FFmpeg installation; standalone Windows and pip paths are the
packaging gaps.

## Implementation evidence to require

- A test fixture in each accepted container (MP4, MOV, WebM), with video and
  with/without audio, proves a generated MP4 contains H.264 and AAC where
  audio is present.
- A non-keyframe start test proves the first output decoded frame is at/after
  the chosen start within one frame interval; an end test verifies duration
  within one frame/audio-sample tolerance.
- Tests cover invalid media, missing video stream, invalid ranges, absent
  FFmpeg/encoder capability, timeout, and cleanup after response.

## Decision

Proceed with FFmpeg/ffprobe subprocess integration and package the binary in
every supported distribution. This resolves the runtime question; the endpoint
and UI tickets can depend on this contract.
