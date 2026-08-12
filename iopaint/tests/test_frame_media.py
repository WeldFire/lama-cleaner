import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from iopaint.frame_media import FrameMediaError, build_frame_table, extract_canonical_png


def test_frame_table_keeps_duplicate_timestamps_distinct_and_uses_rationals(tmp_path):
    payload = {
        "streams": [{"index": 2, "time_base": "1/1000", "width": 640, "height": 360}],
        "frames": [
            {"pts": 100, "best_effort_timestamp": 100, "pkt_duration": 40},
            {"pts": 100, "best_effort_timestamp": 100, "pkt_duration": 40},
            {"pts": 180, "best_effort_timestamp": 180, "pkt_duration": 80},
        ],
    }

    def run(command, **kwargs):
        if command[0] == "ffprobe":
            return SimpleNamespace(stdout=json.dumps(payload))
        return SimpleNamespace(stdout="ffmpeg version 7.1-test\n")

    metadata, frames = build_frame_table(tmp_path / "clip.mp4", "fingerprint", run=run)

    assert metadata["decoder_build_id"] == "ffmpeg version 7.1-test"
    assert [frame["presentation_ordinal"] for frame in frames] == [0, 1, 2]
    assert [frame["pts_ticks"] for frame in frames] == ["100", "100", "180"]
    assert frames[0]["project_time_num"] == "0"
    assert (frames[2]["project_time_num"], frames[2]["project_time_den"]) == ("2", "25")


def test_frame_table_falls_back_from_null_pts_to_best_effort_timestamp(tmp_path):
    payload = {
        "streams": [{"index": 0, "time_base": "1/1000", "width": 16, "height": 16}],
        "frames": [
            {"pts": None, "best_effort_timestamp": 500, "pkt_duration": 40},
            {"pts": 540, "best_effort_timestamp": 540, "pkt_duration": 40},
        ],
    }

    def run(command, **kwargs):
        if command[0] == "ffprobe":
            return SimpleNamespace(stdout=json.dumps(payload))
        return SimpleNamespace(stdout="ffmpeg version 7.1-test\n")

    _, frames = build_frame_table(tmp_path / "missing-pts.mp4", "fingerprint", run=run)

    assert frames[0]["pts_ticks"] is None
    assert frames[0]["best_effort_pts_ticks"] == "500"
    assert frames[0]["project_time_num"] == "0"
    assert frames[1]["project_time_num"] == "1"
    assert frames[1]["project_time_den"] == "25"


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ("not json", "invalid exact-frame index"),
        (json.dumps({"streams": [{"index": 0, "time_base": "0/0"}], "frames": [{}]}), "no usable time base"),
        (
            json.dumps(
                {
                    "streams": [{"index": 0, "time_base": "1/1000"}],
                    "frames": [{"pts": "not-a-timestamp"}],
                }
            ),
            "invalid presentation timestamp",
        ),
    ],
)
def test_frame_table_rejects_invalid_probe_metadata(tmp_path, payload, message):
    def run(command, **kwargs):
        return SimpleNamespace(stdout=payload)

    with pytest.raises(FrameMediaError, match=message):
        build_frame_table(tmp_path / "invalid.mp4", "fingerprint", run=run)


def test_frame_table_translates_probe_process_failures(tmp_path):
    def run(command, **kwargs):
        raise subprocess.CalledProcessError(1, command)

    with pytest.raises(FrameMediaError, match="could not decode an exact frame index"):
        build_frame_table(tmp_path / "corrupt.mp4", "fingerprint", run=run)


def test_extract_targets_decode_ordinal_and_normalizes_display_geometry(tmp_path):
    calls = []
    output = tmp_path / "frame.png"

    def run(command, **kwargs):
        calls.append(command)
        Path(command[-1]).write_bytes(b"PNG")

    extract_canonical_png(
        tmp_path / "source.mov",
        {"decode_ordinal": 7, "video_stream_index": 2},
        output,
        run=run,
    )

    assert output.read_bytes() == b"PNG"
    assert "select=eq(n\\,7),scale=trunc(iw*sar/2)*2:ih,setsar=1,format=rgba" in calls[0]
    assert calls[0][calls[0].index("-map") + 1] == "0:2"


def test_extract_tonemaps_hdr_into_the_canonical_editing_space(tmp_path):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        Path(command[-1]).write_bytes(b"PNG")

    extract_canonical_png(
        tmp_path / "hdr.mov",
        {"decode_ordinal": 0, "video_stream_index": 0, "source_color_transfer": "smpte2084"},
        tmp_path / "hdr.png",
        run=run,
    )

    video_filter = calls[0][calls[0].index("-vf") + 1]
    assert "zscale=t=linear" in video_filter
    assert "tonemap=tonemap=hable" in video_filter
    assert "zscale=p=bt709:t=bt709:m=bt709" in video_filter


def test_extract_translates_ffmpeg_failure_with_stderr(tmp_path):
    def run(command, **kwargs):
        raise subprocess.CalledProcessError(8, command, stderr="No such filter: zscale")

    with pytest.raises(FrameMediaError, match="No such filter: zscale"):
        extract_canonical_png(
            tmp_path / "hdr.mov",
            {"decode_ordinal": 0, "video_stream_index": 0, "source_color_transfer": "smpte2084"},
            tmp_path / "hdr.png",
            run=run,
        )
