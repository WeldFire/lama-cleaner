"""Real-FFmpeg qualification for the exact-frame media contract."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from iopaint.frame_edit_api import FrameEditApi
from iopaint.frame_media import FrameMediaError, build_frame_table, extract_canonical_png, source_fingerprint
from iopaint.project_store import ProjectStore


pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="real-media qualification requires FFmpeg and FFprobe",
)


def ffmpeg(destination: Path, *arguments: str) -> Path:
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *arguments, str(destination)],
        check=True,
        capture_output=True,
        timeout=60,
    )
    return destination


def probe(source: Path, entries: str) -> dict:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", entries, "-of", "json", str(source)],
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    return json.loads(result.stdout)


def make_cfr(tmp_path: Path) -> Path:
    return ffmpeg(
        tmp_path / "cfr-bframes.mp4",
        "-f", "lavfi", "-i", "testsrc2=size=32x24:rate=5:duration=1",
        "-an", "-c:v", "libx264", "-bf", "2", "-g", "10", "-pix_fmt", "yuv420p",
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    )


def make_vfr(tmp_path: Path) -> Path:
    return ffmpeg(
        tmp_path / "vfr.mp4",
        "-f", "lavfi", "-i", "testsrc2=size=32x24:rate=10:duration=1",
        "-vf", "select='eq(n,0)+eq(n,1)+eq(n,3)+eq(n,6)+eq(n,9)'",
        "-vsync", "vfr", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    )


def make_duplicate_pts(tmp_path: Path) -> Path:
    return ffmpeg(
        tmp_path / "duplicate-pts.mov",
        "-f", "lavfi", "-i", "testsrc2=size=32x24:rate=5:duration=1",
        "-vf", "setpts=floor(N/2)/(5*TB)", "-vsync", "0", "-an", "-c:v", "libx264",
    )


def make_vp9_anamorphic(tmp_path: Path) -> Path:
    return ffmpeg(
        tmp_path / "vp9-anamorphic.webm",
        "-f", "lavfi", "-i", "testsrc2=size=32x24:rate=4:duration=1",
        "-vf", "setsar=2/1", "-an", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8",
    )


def make_nonzero_start(tmp_path: Path) -> Path:
    return ffmpeg(
        tmp_path / "nonzero-start.mp4",
        "-f", "lavfi", "-i", "testsrc2=size=32x24:rate=5:duration=1",
        "-vf", "setpts=PTS+2/TB", "-vsync", "vfr", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    )


def make_rotated_mirrored(tmp_path: Path) -> Path:
    encoded = ffmpeg(
        tmp_path / "mirrored.mp4",
        "-f", "lavfi", "-i", "testsrc2=size=32x24:rate=4:duration=1",
        "-vf", "hflip", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    )
    return ffmpeg(
        tmp_path / "rotated-mirrored.mov",
        "-i", str(encoded), "-c", "copy", "-metadata:s:v:0", "rotate=90",
    )


def make_hdr_tagged(tmp_path: Path) -> Path:
    return ffmpeg(
        tmp_path / "hdr-tagged.mp4",
        "-f", "lavfi", "-i", "testsrc2=size=32x24:rate=4:duration=1",
        "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
    )


def make_multistream_audio_offset(tmp_path: Path) -> Path:
    return ffmpeg(
        tmp_path / "multistream-audio-offset.mp4",
        "-f", "lavfi", "-i", "testsrc2=size=32x24:rate=5:duration=1",
        "-f", "lavfi", "-i", "color=red:size=16x16:rate=5:duration=1",
        "-itsoffset", "0.2", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.8",
        "-map", "0:v", "-map", "1:v", "-map", "2:a", "-c:v", "libx264", "-c:a", "aac", "-shortest",
    )


def png_signature(source: Path, frame: dict, destination: Path) -> tuple[str, str, tuple[int, int], str]:
    extract_canonical_png(source, frame, destination)
    with Image.open(destination) as image:
        # Hash decoded pixels so encoder/container byte differences cannot make
        # a visually identical canonical frame look different.
        return (
            hashlib.sha256(destination.read_bytes()).hexdigest(),
            hashlib.sha256(image.tobytes()).hexdigest(),
            image.size,
            image.mode,
        )


def reference_rgba(source: Path, frame: dict) -> bytes:
    """Decode independently from the production extraction command."""
    video_filter = f"select=eq(n\\,{frame['decode_ordinal']}),scale=trunc(iw*sar/2)*2:ih,setsar=1"
    if frame.get("source_color_transfer") in {"smpte2084", "arib-std-b67"}:
        video_filter += (
            ",zscale=t=linear:npl=100,format=gbrpf32le,"
            "tonemap=tonemap=hable:desat=0,"
            "zscale=p=bt709:t=bt709:m=bt709:r=tv"
        )
    result = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-i", str(source),
            "-map", f"0:{frame['video_stream_index']}", "-vf", video_filter,
            "-vsync", "0", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-",
        ],
        check=True,
        capture_output=True,
        timeout=60,
    )
    return result.stdout


def project_time(frame: dict) -> Fraction:
    return Fraction(int(frame["project_time_num"]), int(frame["project_time_den"]))


@pytest.mark.parametrize(
    "factory",
    [
        make_cfr,
        make_vfr,
        make_duplicate_pts,
        make_vp9_anamorphic,
        make_nonzero_start,
        make_rotated_mirrored,
        make_hdr_tagged,
        make_multistream_audio_offset,
    ],
)
def test_supported_real_media_has_stable_frame_keys_and_pngs(tmp_path, factory):
    source = factory(tmp_path)
    fingerprint = source_fingerprint(source.read_bytes())

    metadata, first_table = build_frame_table(source, fingerprint)
    _, reopened_table = build_frame_table(source, fingerprint)

    assert first_table == reopened_table
    assert [frame["presentation_ordinal"] for frame in first_table] == list(range(len(first_table)))
    assert [project_time(frame) for frame in first_table] == sorted(project_time(frame) for frame in first_table)
    assert metadata["width"] > 0 and metadata["height"] > 0

    selected = [first_table[0], first_table[len(first_table) // 2], first_table[-1]]
    for index, frame in enumerate(selected):
        first = png_signature(source, frame, tmp_path / f"{factory.__name__}-{index}-a.png")
        reopened = png_signature(source, frame, tmp_path / f"{factory.__name__}-{index}-b.png")
        assert first == reopened
        assert first[3] == "RGBA"
        with Image.open(tmp_path / f"{factory.__name__}-{index}-a.png") as canonical:
            assert canonical.tobytes() == reference_rgba(source, frame)


def test_vfr_navigation_matches_decoded_presentation_timing(tmp_path):
    source = make_vfr(tmp_path)
    _, frames = build_frame_table(source, source_fingerprint(source.read_bytes()))
    times = [project_time(frame) for frame in frames]
    raw = probe(source, "stream=time_base:frame=best_effort_timestamp")
    time_base = Fraction(raw["streams"][0]["time_base"])
    raw_timestamps = [int(frame["best_effort_timestamp"]) for frame in raw["frames"]]
    expected = [(timestamp - raw_timestamps[0]) * time_base for timestamp in raw_timestamps]

    assert times == expected
    assert len(set(times[index + 1] - times[index] for index in range(len(times) - 1))) > 1
    for ordinal, frame in enumerate(frames):
        assert frame["presentation_ordinal"] == ordinal
        if ordinal:
            assert times[ordinal - 1] <= times[ordinal]
        if ordinal + 1 < len(frames):
            assert times[ordinal] <= times[ordinal + 1]


def test_duplicate_pts_bframes_nonzero_start_and_rotation_are_real(tmp_path):
    duplicate = make_duplicate_pts(tmp_path)
    _, duplicate_frames = build_frame_table(duplicate, source_fingerprint(duplicate.read_bytes()))
    timestamps = [frame["best_effort_pts_ticks"] for frame in duplicate_frames]
    assert len(timestamps) > len(set(timestamps))
    assert len({frame["presentation_ordinal"] for frame in duplicate_frames}) == len(duplicate_frames)

    cfr = make_cfr(tmp_path)
    cfr_metadata, _ = build_frame_table(cfr, source_fingerprint(cfr.read_bytes()))
    decoded = probe(cfr, "frame=pict_type")['frames']
    assert any(frame["pict_type"] == "B" for frame in decoded)
    assert cfr_metadata["color_primaries"] == "bt709"
    assert cfr_metadata["color_transfer"] == "bt709"

    nonzero = make_nonzero_start(tmp_path)
    _, nonzero_frames = build_frame_table(nonzero, source_fingerprint(nonzero.read_bytes()))
    assert int(nonzero_frames[0]["best_effort_pts_ticks"]) > 0
    assert project_time(nonzero_frames[0]) == 0

    rotated = make_rotated_mirrored(tmp_path)
    _, rotated_frames = build_frame_table(rotated, source_fingerprint(rotated.read_bytes()))
    _, _, display_size, _ = png_signature(rotated, rotated_frames[0], tmp_path / "rotated.png")
    assert display_size == (24, 32)


def test_geometry_color_multistream_and_audio_metadata(tmp_path):
    anamorphic = make_vp9_anamorphic(tmp_path)
    anamorphic_metadata, anamorphic_frames = build_frame_table(anamorphic, source_fingerprint(anamorphic.read_bytes()))
    _, _, display_size, _ = png_signature(anamorphic, anamorphic_frames[0], tmp_path / "anamorphic.png")
    assert anamorphic_metadata["sample_aspect_ratio"] == "2:1"
    assert display_size == (64, 24)

    hdr = make_hdr_tagged(tmp_path)
    hdr_metadata, _ = build_frame_table(hdr, source_fingerprint(hdr.read_bytes()))
    assert hdr_metadata["color_primaries"] == "bt2020"
    assert hdr_metadata["color_transfer"] == "smpte2084"
    assert hdr_metadata["color_space"] == "bt2020nc"

    combined = make_multistream_audio_offset(tmp_path)
    combined_metadata, combined_frames = build_frame_table(combined, source_fingerprint(combined.read_bytes()))
    streams = probe(combined, "stream=index,codec_type,start_time,width,height")['streams']
    assert [stream["codec_type"] for stream in streams] == ["video", "video", "audio"]
    # AAC encoder delay shifts the muxed timestamp slightly before the requested
    # 200 ms offset; it must still remain distinctly offset from video zero.
    assert float(streams[2]["start_time"]) >= 0.15
    assert combined_metadata["index"] == streams[0]["index"]
    assert all(frame["video_stream_index"] == streams[0]["index"] for frame in combined_frames)


def test_corrupt_and_timestamp_less_inputs_fail_actionably(tmp_path):
    corrupt = tmp_path / "corrupt.mp4"
    corrupt.write_bytes(b"not a media file")
    with pytest.raises(FrameMediaError, match="could not decode an exact frame index"):
        build_frame_table(corrupt, source_fingerprint(corrupt.read_bytes()))

    missing_pts = ffmpeg(
        tmp_path / "missing-pts.h264",
        "-f", "lavfi", "-i", "testsrc2=size=32x24:rate=5:duration=1",
        "-an", "-c:v", "libx264", "-f", "h264",
    )
    with pytest.raises(FrameMediaError, match="no usable presentation timestamps"):
        build_frame_table(missing_pts, source_fingerprint(missing_pts.read_bytes()))


def test_project_round_trip_reuses_canonical_pixels_and_rejects_corrupt_input(tmp_path):
    source = make_cfr(tmp_path)
    app = FastAPI()
    app.include_router(FrameEditApi(ProjectStore(tmp_path / "projects")).router)
    client = TestClient(app)

    created = client.post(
        "/api/v1/projects",
        data={"name": "Real media"},
        files={"file": (source.name, source.read_bytes(), "video/mp4")},
    )
    assert created.status_code == 200
    project_id = created.json()["project_id"]
    frames = created.json()["frames"]
    assert [frame["presentation_ordinal"] for frame in frames] == list(range(len(frames)))

    middle = len(frames) // 2
    entered = client.put(
        f"/api/v1/projects/{project_id}/session",
        json={"current_ordinal": middle, "trim_start_ordinal": 0, "trim_end_ordinal": len(frames) - 1},
    )
    assert entered.status_code == 200
    selected_key = frames[middle]
    assert client.get(f"/api/v1/projects/{project_id}/frames/{middle}/image").status_code == 200
    returned = client.get(f"/api/v1/projects/{project_id}").json()
    assert returned["session_state"]["current_ordinal"] == middle
    assert returned["frames"][middle]["project_time_num"] == selected_key["project_time_num"]
    assert returned["frames"][middle]["project_time_den"] == selected_key["project_time_den"]
    assert returned["frames"][middle - 1]["presentation_ordinal"] == middle - 1
    assert returned["frames"][middle + 1]["presentation_ordinal"] == middle + 1

    for ordinal in range(len(frames)):
        first = client.get(f"/api/v1/projects/{project_id}/frames/{ordinal}/image")
        reopened = client.get(f"/api/v1/projects/{project_id}/frames/{ordinal}/image")
        assert first.status_code == 200
        assert first.content == reopened.content
        persisted = client.get(f"/api/v1/projects/{project_id}").json()["frames"][ordinal]
        assert persisted["png_hash"] == hashlib.sha256(first.content).hexdigest()

    corrupt = client.post(
        "/api/v1/projects",
        data={"name": "Broken"},
        files={"file": ("broken.mp4", b"not media", "video/mp4")},
    )
    assert corrupt.status_code == 422
    assert corrupt.json()["detail"] == "Unable to build an exact frame index for this video."
    assert [project["name"] for project in client.get("/api/v1/projects").json()] == ["Real media"]
