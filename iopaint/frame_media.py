"""Backend-authoritative frame identity and canonical PNG extraction."""

from __future__ import annotations

import hashlib
import json
import subprocess
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable


CANONICALIZATION_VERSION = "ffmpeg-display-srgb-v1"
Runner = Callable[..., Any]


class FrameMediaError(ValueError):
    pass


def source_fingerprint(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}:size:{len(data)}"


def decoder_build_id(*, run: Runner = subprocess.run) -> str:
    result = run(["ffmpeg", "-version"], check=True, capture_output=True, text=True, timeout=30)
    return result.stdout.splitlines()[0].strip()


def build_frame_table(source: Path, fingerprint: str, *, run: Runner = subprocess.run) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    command = [
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-show_frames",
        "-show_entries", "stream=index,time_base,width,height,sample_aspect_ratio,color_space,color_transfer,color_primaries,color_range:frame=pts,best_effort_timestamp,pkt_duration",
        "-of", "json", str(source),
    ]
    result = run(command, check=True, capture_output=True, text=True, timeout=600)
    payload = json.loads(result.stdout)
    if not payload.get("streams"):
        raise FrameMediaError("The source does not contain a decodable video stream")
    stream = payload["streams"][0]
    time_base = Fraction(stream["time_base"])
    raw_frames = payload.get("frames", [])
    if not raw_frames:
        raise FrameMediaError("The source has no decodable video frames")

    def effective(record: dict[str, Any], decode_ordinal: int) -> tuple[int, int]:
        value = record.get("pts", record.get("best_effort_timestamp"))
        return (int(value) if value is not None else 2**63 - 1, decode_ordinal)

    ordered = sorted(enumerate(raw_frames), key=lambda item: effective(item[1], item[0]))
    timestamp_values = [
        int(record.get("pts", record.get("best_effort_timestamp")))
        for _, record in ordered
        if record.get("pts", record.get("best_effort_timestamp")) is not None
    ]
    if not timestamp_values:
        raise FrameMediaError("The source frames have no usable presentation timestamps")
    first_timestamp = timestamp_values[0]
    build_id = decoder_build_id(run=run)
    frames = []
    for ordinal, (decode_ordinal, record) in enumerate(ordered):
        effective_timestamp = record.get("pts", record.get("best_effort_timestamp"))
        timestamp = first_timestamp if effective_timestamp is None else int(effective_timestamp)
        project_time = (timestamp - first_timestamp) * time_base
        frames.append({
            "source_fingerprint": fingerprint,
            "video_stream_index": int(stream["index"]),
            "presentation_ordinal": ordinal,
            "decode_ordinal": decode_ordinal,
            "pts_ticks": None if record.get("pts") is None else str(record["pts"]),
            "best_effort_pts_ticks": None if record.get("best_effort_timestamp") is None else str(record["best_effort_timestamp"]),
            "duration_ticks": None if record.get("pkt_duration") is None else str(record["pkt_duration"]),
            "stream_time_base_num": str(time_base.numerator),
            "stream_time_base_den": str(time_base.denominator),
            "project_time_num": str(project_time.numerator),
            "project_time_den": str(project_time.denominator),
            "canonicalization_version": CANONICALIZATION_VERSION,
            "decoder_build_id": build_id,
        })
    metadata = {
        key: stream.get(key)
        for key in ("index", "time_base", "width", "height", "sample_aspect_ratio", "color_space", "color_transfer", "color_primaries", "color_range")
    }
    metadata.update({"decoder_build_id": build_id, "canonicalization_version": CANONICALIZATION_VERSION})
    return metadata, frames


def extract_canonical_png(source: Path, frame: dict[str, Any], destination: Path, *, run: Runner = subprocess.run) -> None:
    # FFmpeg autorotation is deliberately retained and versioned here. SAR is baked
    # into display width and the editor receives square-pixel, lossless RGBA pixels.
    select = f"select=eq(n\\,{frame['decode_ordinal']}),scale=trunc(iw*sar/2)*2:ih,setsar=1,format=rgba"
    command = [
        "ffmpeg", "-v", "error", "-i", str(source), "-map", f"0:{frame['video_stream_index']}",
        "-vf", select, "-vsync", "0", "-frames:v", "1", "-f", "image2", "-c:v", "png", "-y", str(destination),
    ]
    run(command, check=True, timeout=600)
    if not destination.is_file() or destination.stat().st_size == 0:
        raise FrameMediaError("Canonical frame extraction produced no image")
