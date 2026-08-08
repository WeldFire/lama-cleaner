"""Request-scoped FFmpeg orchestration for Trimmed Video downloads."""

import json
import math
import shutil
import subprocess
from pathlib import Path
from typing import BinaryIO

from iopaint.video import MAX_VIDEO_BYTES, SUPPORTED_VIDEO_EXTENSIONS, VideoTrimError, trim_video, validate_trim_range


def save_trim_input(source: BinaryIO, filename: str, directory: Path) -> Path:
    """Stream one supported Trim Input without holding it in application memory."""
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_VIDEO_EXTENSIONS:
        raise VideoTrimError("Choose an MP4, MOV, or WebM video.")
    path = directory / f"input{suffix}"
    total = 0
    with path.open("wb") as target:
        while chunk := source.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_VIDEO_BYTES:
                target.close()
                path.unlink(missing_ok=True)
                raise VideoTrimError("Video files must be 2 GB or smaller.")
            target.write(chunk)
    if not total:
        raise VideoTrimError("Choose a non-empty video file.")
    return path


def probe_duration(path: Path) -> float:
    """Read duration and verify that ffprobe finds a video stream."""
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
        check=True, capture_output=True, text=True, timeout=60,
    )
    payload = json.loads(result.stdout)
    if not any(stream.get("codec_type") == "video" for stream in payload.get("streams", [])):
        raise VideoTrimError("The selected file does not contain a decodable video stream.")
    try:
        duration = float(payload["format"]["duration"])
    except (KeyError, TypeError, ValueError) as error:
        raise VideoTrimError("The selected video has no usable duration.") from error
    if not math.isfinite(duration) or duration <= 0:
        raise VideoTrimError("The selected video has no usable duration.")
    return duration


def create_trimmed_video(source: BinaryIO, filename: str, start: float, end: float, directory: Path) -> Path:
    """Create one exact Trimmed Video, retaining only the H.264/AAC output."""
    input_path = save_trim_input(source, filename, directory)
    validate_trim_range(start, end, probe_duration(input_path))
    output_path = directory / f"{Path(filename).stem or 'trimmed'}_trimmed.mp4"
    trim_video(input_path, output_path, start, end)
    if not output_path.is_file() or not output_path.stat().st_size:
        raise VideoTrimError("Video trimming did not produce an output file.")
    return output_path


def remove_temporary_video(directory: Path) -> None:
    shutil.rmtree(directory, ignore_errors=True)
