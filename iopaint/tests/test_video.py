from pathlib import Path
from unittest.mock import patch

import pytest

from iopaint.video import VideoTrimError, trim_video
from iopaint.video_service import probe_video


def test_trim_video_uses_an_exact_range_and_mp4_codecs(tmp_path: Path):
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))

    trim_video(tmp_path / "input.mov", tmp_path / "trimmed.mp4", 1.25, 4.75, run=run)

    command, kwargs = calls[0]
    assert command == [
        "ffmpeg", "-y", "-ss", "1.25", "-i", str(tmp_path / "input.mov"),
        "-t", "3.5", "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264",
        "-c:a", "aac", "-movflags", "+faststart", str(tmp_path / "trimmed.mp4"),
    ]
    assert kwargs == {"check": True, "timeout": 7200}


@pytest.mark.parametrize("start,end", [(0, 0), (2, 1), (-1, 1)])
def test_trim_video_rejects_invalid_ranges(tmp_path: Path, start: float, end: float):
    with pytest.raises(VideoTrimError, match="start time"):
        trim_video(tmp_path / "input.mp4", tmp_path / "trimmed.mp4", start, end)


@patch("iopaint.video_service.subprocess.run")
def test_probe_video_returns_fractional_frame_rate(run, tmp_path: Path):
    run.return_value.stdout = """{
        \"format\": {\"duration\": \"12.5\"},
        \"streams\": [{\"codec_type\": \"video\", \"avg_frame_rate\": \"30000/1001\"}]
    }"""

    duration, frame_rate = probe_video(tmp_path / "input.mp4")

    assert duration == 12.5
    assert frame_rate == pytest.approx(29.97002997002997)
