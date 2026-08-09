from fastapi import FastAPI
from fastapi.testclient import TestClient

from iopaint.frame_edit_api import FrameEditApi
from iopaint.project_store import ProjectStore


def test_project_frame_and_frame_edit_endpoints(tmp_path, monkeypatch):
    frame = {
        "source_fingerprint": "fingerprint",
        "video_stream_index": 0,
        "presentation_ordinal": 0,
        "decode_ordinal": 0,
        "pts_ticks": "0",
        "best_effort_pts_ticks": "0",
        "duration_ticks": "1",
        "stream_time_base_num": "1",
        "stream_time_base_den": "24",
        "project_time_num": "0",
        "project_time_den": "1",
        "canonicalization_version": "test",
        "decoder_build_id": "test",
    }
    monkeypatch.setattr("iopaint.frame_edit_api.build_frame_table", lambda path, fingerprint: ({"width": 16}, [frame]))

    def extract(source, selected, destination):
        destination.write_bytes(b"canonical png")

    monkeypatch.setattr("iopaint.frame_edit_api.extract_canonical_png", extract)
    app = FastAPI()
    app.include_router(FrameEditApi(ProjectStore(tmp_path)).router)
    client = TestClient(app)

    created = client.post(
        "/api/v1/projects",
        data={"name": "Test project"},
        files={"file": ("clip.mp4", b"fake video", "video/mp4")},
    )
    assert created.status_code == 200
    project_id = created.json()["project_id"]
    assert client.get(f"/api/v1/projects/{project_id}/frames").json()[0]["pts_ticks"] == "0"

    image = client.get(f"/api/v1/projects/{project_id}/frames/0/image")
    assert image.status_code == 200
    assert image.content == b"canonical png"

    saved = client.post(
        f"/api/v1/projects/{project_id}/frame-edits",
        data={"ordinal": "0", "document": '{"tool":"erase"}'},
        files={"render": ("render.png", b"edited png", "image/png")},
    )
    assert saved.status_code == 200
    edit_id = saved.json()["id"]
    assert client.get(f"/api/v1/projects/{project_id}/frame-edits").json()[0]["document"] == {"tool": "erase"}
    assert client.delete(f"/api/v1/projects/{project_id}/frame-edits/{edit_id}").json()["deleted"] is True
    assert client.get(f"/api/v1/projects/{project_id}/frame-edits").json() == []
