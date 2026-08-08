from pathlib import Path

import pytest

from iopaint.video import VideoTrimError, trim_video


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
