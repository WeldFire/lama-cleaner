import hashlib
import sqlite3
import threading

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


def test_session_state_is_persisted_with_project(tmp_path):
    store = ProjectStore(tmp_path)
    handle = store.open()
    store.transact(handle, ProjectMutation("set_session_state", {
        "current_ordinal": 7,
        "trim_start_ordinal": 2,
        "trim_end_ordinal": 11,
    }))
    project_id = handle.project_id
    store.close(handle)

    reopened = store.open(project_id, "read")
    assert store.project_snapshot(reopened)["session_state"] == {
        "current_ordinal": 7,
        "trim_start_ordinal": 2,
        "trim_end_ordinal": 11,
    }
    store.close(reopened)


def test_project_rename_updates_catalog_snapshot_and_manifest(tmp_path):
    store = ProjectStore(tmp_path)
    handle = store.open(name="Original name")
    store.transact(handle, ProjectMutation(
        "save_frame_edit", {"id": "edit-1", "ordinal": 0, "document": {}}, {"render": b"render"},
    ))

    revision = store.transact(handle, ProjectMutation("rename_project", {"name": "Vacation cleanup"}))

    assert revision == 2
    assert store.project_snapshot(handle)["name"] == "Vacation cleanup"
    assert store.lifecycle(None, "list")[0]["name"] == "Vacation cleanup"
    manifest = (handle.path / "manifest.json").read_text(encoding="utf-8")
    assert '"name": "Vacation cleanup"' in manifest
    store.close(handle)


def test_draft_project_is_listed_only_after_first_frame_edit(tmp_path):
    store = ProjectStore(tmp_path)
    handle = store.open(name="Draft clip")

    assert store.project_snapshot(handle)["durable"] is False
    assert store.lifecycle(None, "list") == []

    store.transact(handle, ProjectMutation(
        "save_frame_edit", {"id": "edit-1", "ordinal": 0, "document": {}}, {"render": b"render"},
    ))

    assert store.project_snapshot(handle)["durable"] is True
    assert store.lifecycle(None, "list")[0]["name"] == "Draft clip"

    # Simulate interruption after the authoritative project commit but before
    # the catalog cache was updated; listing repairs the promotion.
    with sqlite3.connect(store._catalog) as catalog:
        catalog.execute("UPDATE projects SET activated_at=NULL WHERE id=?", (handle.project_id,))
    restarted = ProjectStore(tmp_path)
    assert restarted.lifecycle(None, "list")[0]["name"] == "Draft clip"
    store.close(handle)


def test_drafts_are_physically_removed_on_exit_and_backend_restart(tmp_path):
    store = ProjectStore(tmp_path)
    exited = store.open(name="Exited draft")
    exited_path = exited.path
    exited_id = exited.project_id
    store.close(exited)

    assert store.lifecycle(exited_id, "discard-draft")["deleted"] is True
    assert not exited_path.exists()

    abandoned = store.open(name="Abandoned draft")
    abandoned_path = abandoned.path
    store.close(abandoned)
    restarted = ProjectStore(tmp_path)

    assert restarted.lifecycle(None, "list") == []
    assert not abandoned_path.exists()


def test_draft_discard_waits_for_first_frame_edit_promotion(tmp_path, monkeypatch):
    store = ProjectStore(tmp_path)
    initial = store.open(name="Promotion race")
    project_id = initial.project_id
    store.close(initial)
    mutation_started = threading.Event()
    allow_commit = threading.Event()
    original_apply = store._apply_mutation

    def pause_first_save(connection, kind, payload):
        original_apply(connection, kind, payload)
        if kind == "save_frame_edit":
            mutation_started.set()
            assert allow_commit.wait(timeout=2)

    monkeypatch.setattr(store, "_apply_mutation", pause_first_save)

    def save_edit():
        handle = store.open(project_id)
        try:
            store.transact(handle, ProjectMutation(
                "save_frame_edit", {"id": "edit-1", "ordinal": 0, "document": {}}, {"render": b"render"},
            ))
        finally:
            store.close(handle)

    save_thread = threading.Thread(target=save_edit)
    save_thread.start()
    assert mutation_started.wait(timeout=2)
    cleanup_result = {}
    cleanup_thread = threading.Thread(
        target=lambda: cleanup_result.update(store.lifecycle(project_id, "discard-draft"))
    )
    cleanup_thread.start()
    allow_commit.set()
    save_thread.join(timeout=2)
    cleanup_thread.join(timeout=2)

    assert cleanup_result["deleted"] is False
    reopened = store.open(project_id, "read")
    assert store.project_snapshot(reopened)["frame_edits"][0]["id"] == "edit-1"
    store.close(reopened)
