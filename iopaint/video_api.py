"""FastAPI boundary for browser-downloaded Trimmed Videos."""

import subprocess
import tempfile
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from iopaint.video import VideoTrimError
from iopaint.video_service import create_trimmed_video, probe_video, remove_temporary_video, save_trim_input


def api_trim_video(start: float, end: float, file: UploadFile):
    """Return a request-scoped MP4 and remove its temporary files after download."""
    directory = Path(tempfile.mkdtemp(prefix="iopaint-video-trim-"))
    try:
        output = create_trimmed_video(file.file, file.filename or "trimmed.mp4", start, end, directory)
        return FileResponse(
            output,
            media_type="video/mp4",
            filename=output.name,
            background=BackgroundTask(remove_temporary_video, directory),
        )
    except VideoTrimError as error:
        remove_temporary_video(directory)
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        remove_temporary_video(directory)
        raise HTTPException(status_code=422, detail="Unable to trim this video. Please try another file or range.") from error


def api_probe_video(file: UploadFile):
    """Return source frame rate for exact browser frame stepping when available."""
    directory = Path(tempfile.mkdtemp(prefix="iopaint-video-probe-"))
    try:
        input_path = save_trim_input(file.file, file.filename or "video.mp4", directory)
        _, frame_rate = probe_video(input_path)
        return {"frame_rate": frame_rate}
    except VideoTrimError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        raise HTTPException(status_code=422, detail="Unable to read this video's frame rate.") from error
    finally:
        remove_temporary_video(directory)
