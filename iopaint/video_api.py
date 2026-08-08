"""FastAPI boundary for browser-downloaded Trimmed Videos."""

import subprocess
import tempfile
from pathlib import Path

from fastapi import HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from iopaint.video import VideoTrimError
from iopaint.video_service import create_trimmed_video, remove_temporary_video


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
