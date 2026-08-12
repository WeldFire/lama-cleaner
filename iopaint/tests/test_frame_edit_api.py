import json
import sqlite3

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
    store = ProjectStore(tmp_path)
    app.include_router(FrameEditApi(store).router)
    client = TestClient(app)

    created = client.post(
        "/api/v1/projects",
        data={"name": "Test project"},
        files={"file": ("clip.mp4", b"fake video", "video/mp4")},
    )
    assert created.status_code == 200
    project_id = created.json()["project_id"]
    assert created.json()["name"] == "Test project"
    assert created.json()["durable"] is False
    renamed = client.patch(f"/api/v1/projects/{project_id}", json={"name": "Renamed project"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Renamed project"
    assert client.get("/api/v1/projects").json() == []
    assert client.patch(f"/api/v1/projects/{project_id}", json={"name": "  "}).status_code == 400
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
    assert client.get("/api/v1/projects").json()[0]["name"] == "Renamed project"
    assert client.get(f"/api/v1/projects/{project_id}").json()["durable"] is True
    with sqlite3.connect(store._catalog) as catalog:
        catalog.execute("UPDATE projects SET activated_at=NULL WHERE id=?", (project_id,))
    stale_draft_cleanup = client.delete(f"/api/v1/projects/{project_id}?draft_only=true")
    assert stale_draft_cleanup.json()["deleted"] is False
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 200
    edit_id = saved.json()["id"]
    assert client.get(f"/api/v1/projects/{project_id}/frame-edits").json()[0]["document"] == {"tool": "erase"}
    reopened = client.get(f"/api/v1/projects/{project_id}/frame-edits/{edit_id}/image")
    assert reopened.status_code == 200
    assert reopened.content == b"edited png"
    assert client.get(f"/api/v1/projects/{project_id}/frame-edits/{edit_id}/mask").status_code == 404

    resumable_document = {
        "schema_version": 2,
        "revision": 1,
        "frame_key": {"ordinal": 0, "project_time_num": "0", "project_time_den": "1"},
        "canonical_image": {"ordinal": 0},
        "canvas": {"width": 16, "height": 16},
        "crop": {"x": 0, "y": 0, "width": 16, "height": 16},
        "mask": {"format": "image/png", "coordinate_space": "canvas"},
        "lines": {"committed": [], "current": []},
        "tools": {"base_brush_size": 20, "brush_size_scale": 1},
        "operation": {"kind": "image-edit", "model": "cv2", "settings": {}},
    }
    rejected = client.post(
        f"/api/v1/projects/{project_id}/frame-edits",
        data={"ordinal": "0", "document": json.dumps(resumable_document)},
        files={"render": ("render.png", b"updated png", "image/png")},
    )
    assert rejected.status_code == 400

    updated = client.post(
        f"/api/v1/projects/{project_id}/frame-edits",
        data={
            "ordinal": "0",
            "frame_edit_id": edit_id,
            "document": json.dumps(resumable_document),
        },
        files={
            "render": ("render.png", b"updated png", "image/png"),
            "mask": ("mask.png", b"editable mask", "image/png"),
        },
    )
    assert updated.status_code == 200
    assert updated.json()["document"] == resumable_document
    assert updated.json()["render_hash"]
    assert updated.json()["mask_hash"]
    restored_mask = client.get(f"/api/v1/projects/{project_id}/frame-edits/{edit_id}/mask")
    assert restored_mask.status_code == 200
    assert restored_mask.content == b"editable mask"
    stale_revision = client.post(
        f"/api/v1/projects/{project_id}/frame-edits",
        data={"ordinal": "0", "frame_edit_id": edit_id, "document": json.dumps(resumable_document)},
        files={
            "render": ("render.png", b"stale render", "image/png"),
            "mask": ("mask.png", b"stale mask", "image/png"),
        },
    )
    assert stale_revision.status_code == 409
    assert client.get(f"/api/v1/projects/{project_id}/frame-edits/{edit_id}/image").content == b"updated png"
    assert client.delete(f"/api/v1/projects/{project_id}/frame-edits/{edit_id}").json()["deleted"] is True
    assert client.get(f"/api/v1/projects/{project_id}/frame-edits").json() == []

    source = client.get(f"/api/v1/projects/{project_id}/source")
    assert source.status_code == 200
    assert source.content == b"fake video"
    assert 'filename="clip.mp4"' in source.headers["content-disposition"]

    saved_session = client.put(
        f"/api/v1/projects/{project_id}/session",
        json={"current_ordinal": 0, "trim_start_ordinal": 0, "trim_end_ordinal": 0},
    )
    assert saved_session.status_code == 200
    reopened_project = client.get(f"/api/v1/projects/{project_id}").json()
    assert reopened_project["session_state"] == {
        "current_ordinal": 0,
        "trim_start_ordinal": 0,
        "trim_end_ordinal": 0,
    }

    deleted_project = client.delete(f"/api/v1/projects/{project_id}")
    assert deleted_project.status_code == 200
    assert deleted_project.json() == {"project_id": project_id, "deleted": True}
    assert all(item["id"] != project_id for item in client.get("/api/v1/projects").json())
    assert client.delete("/api/v1/projects/missing").status_code == 404
