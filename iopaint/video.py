"""FFmpeg-backed operations for the local video trimming workflow."""

import math
import subprocess
from pathlib import Path
from typing import Callable, Sequence


MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024
SUPPORTED_VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm"}
FFMPEG_TIMEOUT_SECONDS = 7200


class VideoTrimError(ValueError):
    """Raised when a Trim Range cannot produce a valid Trimmed Video."""


def validate_trim_range(start: float, end: float, duration: float | None = None) -> None:
    if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start:
        raise VideoTrimError("The start time must be non-negative and before the end time.")
    if duration is not None and end > duration:
        raise VideoTrimError("The end time must be within the input video duration.")


def trim_video(
    input_path: Path,
    output_path: Path,
    start: float,
    end: float,
    *,
    run: Callable[..., object] = subprocess.run,
) -> None:
    """Transcode one exact Trim Range to an H.264/AAC MP4 without a shell."""
    validate_trim_range(start, end)
    command: Sequence[str] = [
        "ffmpeg", "-y", "-ss", str(start), "-i", str(input_path),
        "-t", str(end - start), "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart",
        str(output_path),
    ]
    run(command, check=True, timeout=FFMPEG_TIMEOUT_SECONDS)
