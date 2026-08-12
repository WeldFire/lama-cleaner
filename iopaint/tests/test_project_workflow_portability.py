import json
import shutil
from pathlib import Path

from iopaint.project_store import ProjectMutation, ProjectStore


def test_project_directory_moves_between_platform_style_roots(tmp_path):
    """Self-contained projects retain authored work without model hardware."""
    native_root = tmp_path / "native user data" / "IOPaint"
    store = ProjectStore(native_root, instance_id="native")
    handle = store.open(name="Portable workflow")
    store.transact(handle, ProjectMutation(
        "register_source",
        {"id": "source", "filename": "clip.webm", "fingerprint": "source-v2:test", "metadata": {"platform": "agnostic"}},
        {"source": b"video"},
    ))
    store.transact(handle, ProjectMutation("replace_frames", {"frames": [{
        "presentation_ordinal": 0, "source_fingerprint": "source-v2:test",
        "project_time_num": "0", "project_time_den": "1",
    }]}))
    store.transact(handle, ProjectMutation(
        "save_frame_edit",
        {"id": "edit", "ordinal": 0, "document": {"schema_version": 2, "revision": 1}},
        {"render": b"render", "mask": b"mask"},
    ))
    store.transact(handle, ProjectMutation("set_session_state", {
        "current_ordinal": 0, "trim_start_ordinal": 0, "trim_end_ordinal": 0,
    }))
    project_id = handle.project_id
    store.close(handle)

    docker_root = tmp_path / "docker-volume" / "data" / "projects"
    destination = docker_root / "projects" / project_id
    destination.parent.mkdir(parents=True)
    shutil.copytree(native_root / "projects" / project_id, destination)
    reopened_store = ProjectStore(docker_root, instance_id="docker")
    reopened = reopened_store.open(project_id, "read")
    snapshot = reopened_store.project_snapshot(reopened)
    assert snapshot["name"] == "Portable workflow"
    assert snapshot["session_state"]["current_ordinal"] == 0
    assert snapshot["frame_edits"][0]["document"]["revision"] == 1
    assert reopened_store.asset_path(reopened, snapshot["frame_edits"][0]["mask_hash"]).read_bytes() == b"mask"
    assert json.loads((reopened.path / "manifest.json").read_text())["project_id"] == project_id
    reopened_store.close(reopened)


def test_project_workflow_requires_no_tracking_or_gpu_runtime(tmp_path, monkeypatch):
    monkeypatch.delenv("CUDA_VISIBLE_DEVICES", raising=False)
    store = ProjectStore(tmp_path, instance_id="cpu-only")
    handle = store.open()
    store.transact(handle, ProjectMutation("replace_frames", {"frames": []}))
    assert store.project_snapshot(handle)["revision"] == 1
    store.close(handle)


def test_compose_uses_independent_persistent_project_volume():
    compose = (Path(__file__).parents[2] / "docker-compose.yml").read_text(encoding="utf-8")
    assert "PROJECT_DATA_DIR=/data/projects" in compose
    assert "projects:/data/projects" in compose
    assert "models:/models" in compose
    assert "./web_app:/app" in compose
    assert compose.count("projects:/data/projects") == 1
