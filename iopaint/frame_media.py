"""Backend-authoritative frame identity and canonical PNG extraction."""

from __future__ import annotations

import hashlib
import json
import subprocess
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable


CANONICALIZATION_VERSION = "ffmpeg-display-srgb-v2"
Runner = Callable[..., Any]


class FrameMediaError(ValueError):
    pass


def source_fingerprint(data: bytes, metadata: dict[str, Any] | None = None) -> str:
    """Return a layered, portable identity for a Trim Input.

    Sample hashes make comparison cheap to explain, normalized stream properties
    reject structurally different media, and the full hash resolves collisions or
    ambiguity before timestamp-dependent work is attached.
    """
    sample_size = min(64 * 1024, len(data))
    middle = max(0, (len(data) - sample_size) // 2)
    normalized = {
        key: metadata.get(key)
        for key in ("width", "height", "time_base", "video_stream_index", "sample_aspect_ratio", "color_space", "color_transfer", "color_primaries")
        if metadata and key in metadata
    }
    payload = {
        "version": 2,
        "size": len(data),
        "media": normalized,
        "samples": [
            hashlib.sha256(data[:sample_size]).hexdigest(),
            hashlib.sha256(data[middle:middle + sample_size]).hexdigest(),
            hashlib.sha256(data[-sample_size:]).hexdigest(),
        ],
        "full_sha256": hashlib.sha256(data).hexdigest(),
    }
    return "source-v2:" + json.dumps(payload, sort_keys=True, separators=(",", ":"))


def legacy_source_fingerprint(data: bytes) -> str:
    """Compute the v1 identity so existing projects can be safely migrated."""
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
    try:
        result = run(command, check=True, capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise FrameMediaError("FFprobe could not decode an exact frame index for this video") from error
    try:
        payload = json.loads(result.stdout)
    except (json.JSONDecodeError, TypeError) as error:
        raise FrameMediaError("FFprobe returned an invalid exact-frame index") from error
    if not payload.get("streams"):
        raise FrameMediaError("The source does not contain a decodable video stream")
    stream = payload["streams"][0]
    try:
        time_base = Fraction(stream["time_base"])
    except (KeyError, TypeError, ValueError, ZeroDivisionError) as error:
        raise FrameMediaError("The video stream has no usable time base") from error
    raw_frames = payload.get("frames", [])
    if not raw_frames:
        raise FrameMediaError("The source has no decodable video frames")

    def timestamp_for(record: dict[str, Any]) -> int | None:
        # FFprobe includes explicit null PTS fields for some containers. Those
        # frames still have exact identity when best-effort presentation time is
        # available, so test value presence rather than key presence.
        value = record.get("pts")
        if value is None:
            value = record.get("best_effort_timestamp")
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError) as error:
            raise FrameMediaError("A video frame has an invalid presentation timestamp") from error

    def effective(record: dict[str, Any], decode_ordinal: int) -> tuple[int, int]:
        value = timestamp_for(record)
        return (int(value) if value is not None else 2**63 - 1, decode_ordinal)

    ordered = sorted(enumerate(raw_frames), key=lambda item: effective(item[1], item[0]))
    timestamp_values = []
    for _, record in ordered:
        timestamp = timestamp_for(record)
        if timestamp is not None:
            timestamp_values.append(timestamp)
    if not timestamp_values:
        raise FrameMediaError("The source frames have no usable presentation timestamps")
    first_timestamp = timestamp_values[0]
    build_id = decoder_build_id(run=run)
    frames = []
    for ordinal, (decode_ordinal, record) in enumerate(ordered):
        effective_timestamp = timestamp_for(record)
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
            "source_color_space": stream.get("color_space"),
            "source_color_transfer": stream.get("color_transfer"),
            "source_color_primaries": stream.get("color_primaries"),
            "source_color_range": stream.get("color_range"),
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
    select = f"select=eq(n\\,{frame['decode_ordinal']}),scale=trunc(iw*sar/2)*2:ih,setsar=1"
    if frame.get("source_color_transfer") in {"smpte2084", "arib-std-b67"}:
        # Convert HDR transfer functions to a deterministic SDR editing space.
        # This keeps canonical PNGs display-safe while retaining source color
        # metadata in the frame table for later video rendering decisions.
        select += (
            ",zscale=t=linear:npl=100,format=gbrpf32le,"
            "tonemap=tonemap=hable:desat=0,"
            "zscale=p=bt709:t=bt709:m=bt709:r=tv"
        )
    select += ",format=rgba"
    command = [
        "ffmpeg", "-v", "error", "-i", str(source), "-map", f"0:{frame['video_stream_index']}",
        "-vf", select, "-vsync", "0", "-frames:v", "1", "-f", "image2", "-c:v", "png", "-y", str(destination),
    ]
    run(command, check=True, timeout=600)
    if not destination.is_file() or destination.stat().st_size == 0:
        raise FrameMediaError("Canonical frame extraction produced no image")
