import json
from pathlib import Path
from types import SimpleNamespace

from iopaint.frame_media import build_frame_table, extract_canonical_png


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
