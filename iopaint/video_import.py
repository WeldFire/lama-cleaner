"""Safe server-side retrieval for pasted video URLs."""

import ipaddress
import socket
import subprocess
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from iopaint.video import MAX_VIDEO_BYTES, VideoTrimError
from iopaint.video_service import probe_duration, remove_temporary_video

MAX_HTML_BYTES = 1024 * 1024
MAX_HTML_VIDEO_REDIRECTS = 2
VIDEO_CONTENT_TYPES = {
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
    "video/webm": ".webm",
}


class _MinimalVideoPageParser(HTMLParser):
    """Find the first media source, rejecting a page with ordinary text."""

    def __init__(self) -> None:
        super().__init__()
        self.media_url: str | None = None
        self.has_text = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in {"video", "source"} or self.media_url is not None:
            return
        attributes = dict(attrs)
        if attributes.get("src"):
            self.media_url = attributes["src"]

    def handle_data(self, data: str) -> None:
        if data.strip():
            self.has_text = True


def _validate_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise VideoTrimError("Paste a complete HTTP(S) video URL.")
    for result in socket.getaddrinfo(parsed.hostname, None):
        if not ipaddress.ip_address(result[4][0]).is_global:
            raise VideoTrimError("Video URLs cannot point to private networks.")


class _SafeVideoRedirectHandler(HTTPRedirectHandler):
    """Validate every HTTP redirect before urllib follows it."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _html_video_url(html: bytes, page_url: str) -> str:
    parser = _MinimalVideoPageParser()
    parser.feed(html.decode("utf-8", errors="replace"))
    if parser.has_text or not parser.media_url:
        raise VideoTrimError("The URL returned a web page instead of a video.")
    media_url = urljoin(page_url, parser.media_url)
    _validate_url(media_url)
    return media_url


def _filename_suffix(url: str, content_type: str) -> str:
    suffix = Path(urlparse(url).path).suffix.lower()
    if suffix in {".mp4", ".mov", ".webm"}:
        return suffix
    return VIDEO_CONTENT_TYPES.get(content_type, ".mp4")


def _download_video(url: str, directory: Path) -> tuple[Path, str, str]:
    """Download a direct video or follow one minimal HTML media page."""
    current_url = url
    opener = build_opener(_SafeVideoRedirectHandler())
    for _ in range(MAX_HTML_VIDEO_REDIRECTS + 1):
        _validate_url(current_url)
        request = Request(current_url, headers={"User-Agent": "IOPaint video importer"})
        with opener.open(request, timeout=30) as response:
            content_type = response.headers.get_content_type()
            if content_type == "text/html":
                html = response.read(MAX_HTML_BYTES + 1)
                if len(html) > MAX_HTML_BYTES:
                    raise VideoTrimError("The URL returned a web page instead of a video.")
                current_url = _html_video_url(html, response.url)
                continue

            suffix = _filename_suffix(response.url, content_type)
            path = directory / f"imported{suffix}"
            total = 0
            with path.open("wb") as target:
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_VIDEO_BYTES:
                        raise VideoTrimError("Video files must be 2 GB or smaller.")
                    target.write(chunk)
            if not total:
                raise VideoTrimError("The video URL returned an empty file.")

        try:
            probe_duration(path)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, VideoTrimError) as error:
            path.unlink(missing_ok=True)
            raise VideoTrimError("The URL did not return a decodable video.") from error
        return path, suffix, content_type

    raise VideoTrimError("The HTML video link redirected too many times.")


def import_video_url(url: str):
    directory = Path(tempfile.mkdtemp(prefix="iopaint-video-import-"))
    try:
        path, suffix, content_type = _download_video(url, directory)
        media_type = content_type if content_type in VIDEO_CONTENT_TYPES else "application/octet-stream"
        return FileResponse(
            path,
            media_type=media_type,
            filename=f"imported{suffix}",
            background=BackgroundTask(remove_temporary_video, directory),
        )
    except VideoTrimError as error:
        remove_temporary_video(directory)
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        remove_temporary_video(directory)
        raise HTTPException(status_code=422, detail="Unable to import this video URL.") from error
