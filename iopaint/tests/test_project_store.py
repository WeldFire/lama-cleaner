import hashlib

import pytest

from iopaint.project_store import ProjectMutation, ProjectStore


def test_project_store_commits_assets_before_metadata_and_reopens(tmp_path):
    store = ProjectStore(tmp_path)
    handle = store.open(name="Frame project")
    source = b"video bytes"
    digest = hashlib.sha256(source).hexdigest()

    revision = store.transact(handle, ProjectMutation(
        "register_source",
        {"id": "source-1", "filename": "clip.mp4", "fingerprint": "fingerprint"},
        {"source": source},
    ))
    project_id = handle.project_id
    store.close(handle)

    assert revision == 1
    reopened = store.open(project_id, "read")
    snapshot = store.project_snapshot(reopened)
    assert snapshot["source"]["asset_hash"] == digest
    assert store.asset_path(reopened, digest).read_bytes() == source
    assert snapshot["revision"] == 1
    store.close(reopened)


def test_new_writer_fences_previous_handle(tmp_path):
    store = ProjectStore(tmp_path)
    previous = store.open()
    current = store.open(previous.project_id)

    with pytest.raises(PermissionError, match="fenced"):
        store.transact(previous, ProjectMutation("replace_frames", {"frames": []}))

    assert store.transact(current, ProjectMutation("replace_frames", {"frames": []})) == 1
    store.close(previous)
    store.close(current)


def test_frame_edit_is_logically_deleted_and_assets_remain(tmp_path):
    store = ProjectStore(tmp_path)
    handle = store.open()
    store.transact(handle, ProjectMutation("replace_frames", {"frames": [{"presentation_ordinal": 0}]}))
    store.transact(handle, ProjectMutation(
        "save_frame_edit", {"id": "edit-1", "ordinal": 0, "document": {"tool": "erase"}},
        {"render": b"render", "mask": b"mask"},
    ))
    edit = store.project_snapshot(handle)["frame_edits"][0]
    render_path = store.asset_path(handle, edit["render_hash"])

    store.transact(handle, ProjectMutation("delete_frame_edit", {"id": "edit-1"}))

    assert store.project_snapshot(handle)["frame_edits"] == []
    assert render_path.read_bytes() == b"render"
    store.close(handle)
