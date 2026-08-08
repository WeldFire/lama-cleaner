from unittest.mock import patch

import pytest

from iopaint.video import VideoTrimError
from iopaint.video_import import _html_video_url, _validate_url


@patch("iopaint.video_import.socket.getaddrinfo")
def test_validate_url_accepts_public_extensionless_video(getaddrinfo):
    getaddrinfo.return_value = [(2, 1, 6, "", ("8.8.8.8", 0))]

    assert _validate_url("https://cdn.example.com/video?id=123") is None


@patch("iopaint.video_import.socket.getaddrinfo")
def test_validate_url_rejects_private_destination(getaddrinfo):
    getaddrinfo.return_value = [(2, 1, 6, "", ("127.0.0.1", 0))]

    with pytest.raises(VideoTrimError, match="private networks"):
        _validate_url("https://cdn.example.com/clip.mp4")


@patch("iopaint.video_import.socket.getaddrinfo")
def test_minimal_html_page_can_point_to_a_video(getaddrinfo):
    getaddrinfo.return_value = [(2, 1, 6, "", ("8.8.8.8", 0))]

    assert _html_video_url(
        b'<video controls><source src="/media/video?id=42"></video>',
        "https://cdn.example.com/watch?id=42",
    ) == "https://cdn.example.com/media/video?id=42"


def test_html_page_with_text_is_not_a_video_import():
    with pytest.raises(VideoTrimError, match="web page"):
        _html_video_url(b"<h1>Watch this video</h1><video src='video.mp4'>", "https://cdn.example.com/watch")
