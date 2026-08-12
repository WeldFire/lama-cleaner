import hashlib
import json
import sqlite3
import threading
import os
import shutil
import time

import pytest

from iopaint.project_store import ProjectMutation, ProjectStore


class FaultAt:
    def __init__(self, boundary):
        self.boundary = boundary
        self.armed = False

    def __call__(self, boundary):
        if self.armed and boundary == self.boundary:
            raise RuntimeError(f"injected fault at {boundary}")


@pytest.mark.parametrize("boundary", [
    "creation:metadata:before", "creation:metadata:after", "creation:catalog:before", "creation:catalog:after",
    "manifest:before-write", "manifest:after-fsync", "manifest:after-replace",
])
def test_project_creation_fault_never_exposes_partial_draft(tmp_path, boundary):
    fault = FaultAt(boundary)
    fault.armed = True
    store = ProjectStore(tmp_path, fault_hook=fault)
    with pytest.raises(RuntimeError):
        store.open(name="Interrupted creation")

    recovered = ProjectStore(tmp_path)
    assert recovered.lifecycle(None, "list") == []
    assert all(not (path / "manifest.json").exists() for path in recovered.projects_dir.iterdir())


def test_startup_adopts_valid_uncataloged_portable_project(tmp_path):
    source_root = tmp_path / "source"
    destination_root = tmp_path / "destination"
    store = ProjectStore(source_root)
    handle = store.open(name="Portable project")
    store.transact(handle, ProjectMutation(
        "save_frame_edit", {"id": "edit", "ordinal": 0, "document": {}}, {"render": b"authored"},
    ))
    project_id = handle.project_id
    store.close(handle)
    destination_project = destination_root / "projects" / project_id
    destination_project.parent.mkdir(parents=True)
    shutil.copytree(source_root / "projects" / project_id, destination_project)

    recovered = ProjectStore(destination_root)
    assert recovered.lifecycle(None, "list")[0]["name"] == "Portable project"
    reopened = recovered.open(project_id, "read")
    assert recovered.project_snapshot(reopened)["frame_edits"][0]["id"] == "edit"
    recovered.close(reopened)


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


@pytest.mark.parametrize("boundary", [
    "asset:render:before-write", "asset:render:after-fsync", "asset:render:after-replace",
    "asset:mask:before-write", "asset:mask:after-fsync", "asset:mask:after-replace",
    "metadata:before", "metadata:after", "catalog:before", "catalog:after",
    "manifest:before-write", "manifest:after-fsync", "manifest:after-replace",
])
def test_fault_boundaries_recover_complete_prior_or_new_revision(tmp_path, boundary):
    fault = FaultAt(boundary)
    store = ProjectStore(tmp_path, fault_hook=fault)
    handle = store.open(name="Fault project")
    store.transact(handle, ProjectMutation(
        "save_frame_edit", {"id": "edit-1", "ordinal": 0, "document": {"revision": 1}},
        {"render": b"prior-render", "mask": b"prior-mask"},
    ))
    project_id = handle.project_id
    fault.armed = True
    with pytest.raises(RuntimeError, match="injected fault"):
        store.transact(handle, ProjectMutation(
            "save_frame_edit", {"id": "edit-1", "ordinal": 0, "document": {"revision": 2}},
            {"render": b"new-render", "mask": b"new-mask"},
        ))
    store.close(handle)

    recovered = ProjectStore(tmp_path)
    reopened = recovered.open(project_id, "read")
    snapshot = recovered.project_snapshot(reopened)
    edit = snapshot["frame_edits"][0]
    assert edit["document"]["revision"] in {1, 2}
    expected = b"prior-render" if edit["document"]["revision"] == 1 else b"new-render"
    expected_mask = b"prior-mask" if edit["document"]["revision"] == 1 else b"new-mask"
    render = recovered.asset_path(reopened, edit["render_hash"])
    mask = recovered.asset_path(reopened, edit["mask_hash"])
    assert render.read_bytes() == expected
    assert mask.read_bytes() == expected_mask
    assert hashlib.sha256(render.read_bytes()).hexdigest() == edit["render_hash"]
    assert hashlib.sha256(mask.read_bytes()).hexdigest() == edit["mask_hash"]
    assert json.loads((reopened.path / "manifest.json").read_text())["revision"] == snapshot["revision"]
    # Fresh temporary files are deliberately retained through the grace period;
    # they are never referenced by the committed snapshot and are reclaimed by
    # the separately fault-tested cleanup pass.
    assert all(path.suffix == ".tmp" for path in (reopened.path / "tmp").iterdir())
    recovered.close(reopened)


def test_restart_removes_orphan_temporary_and_content_addressed_assets(tmp_path):
    store = ProjectStore(tmp_path)
    handle = store.open()
    store.transact(handle, ProjectMutation(
        "save_frame_edit", {"id": "edit-1", "ordinal": 0, "document": {}}, {"render": b"render"},
    ))
    project_id = handle.project_id
    orphan_digest = hashlib.sha256(b"orphan").hexdigest()
    orphan = handle.path / "assets" / orphan_digest[:2] / orphan_digest
    orphan.parent.mkdir(parents=True, exist_ok=True)
    orphan.write_bytes(b"orphan")
    temporary = handle.path / "tmp" / "interrupted.tmp"
    temporary.write_bytes(b"partial")
    expired = time.time() - 2 * 24 * 60 * 60
    os.utime(orphan, (expired, expired))
    os.utime(temporary, (expired, expired))
    store.close(handle)

    ProjectStore(tmp_path)
    assert not orphan.exists()
    assert not temporary.exists()


@pytest.mark.parametrize("boundary", ["cleanup:temporary", "cleanup:orphan-asset"])
def test_cleanup_fault_is_retryable_without_exposing_partial_state(tmp_path, boundary):
    store = ProjectStore(tmp_path)
    handle = store.open()
    store.transact(handle, ProjectMutation(
        "save_frame_edit", {"id": "edit-1", "ordinal": 0, "document": {}}, {"render": b"render"},
    ))
    project_id = handle.project_id
    orphan_digest = hashlib.sha256(b"orphan").hexdigest()
    orphan = handle.path / "assets" / orphan_digest[:2] / orphan_digest
    orphan.parent.mkdir(parents=True, exist_ok=True)
    orphan.write_bytes(b"orphan")
    temporary = handle.path / "tmp" / "old.tmp"
    temporary.write_bytes(b"partial")
    expired = time.time() - 2 * 24 * 60 * 60
    os.utime(orphan, (expired, expired))
    os.utime(temporary, (expired, expired))
    store.close(handle)

    def cleanup_fault(candidate):
        if candidate == boundary:
            raise PermissionError("locked cleanup target")

    interrupted = ProjectStore(tmp_path, fault_hook=cleanup_fault)
    reopened = interrupted.open(project_id, "read")
    assert interrupted.project_snapshot(reopened)["frame_edits"][0]["id"] == "edit-1"
    interrupted.close(reopened)
    recovered = ProjectStore(tmp_path)
    reopened = recovered.open(project_id, "read")
    assert recovered.project_snapshot(reopened)["frame_edits"][0]["id"] == "edit-1"
    recovered.close(reopened)
    assert not orphan.exists()
    assert not temporary.exists()


def test_relink_source_assets_frames_and_audit_commit_together(tmp_path):
    store = ProjectStore(tmp_path)
    handle = store.open()
    store.transact(handle, ProjectMutation(
        "register_source", {"id": "source", "filename": "old.mp4", "fingerprint": "old"}, {"source": b"old"},
    ))
    store.transact(handle, ProjectMutation("replace_frames", {"frames": [{"presentation_ordinal": 0, "source_fingerprint": "old"}]}))
    revision = store.transact(handle, ProjectMutation("relink_source", {
        "id": "source", "filename": "new.mp4", "fingerprint": "new", "metadata": {},
        "frames": [{"presentation_ordinal": 0, "source_fingerprint": "new"}],
        "relink_attempt": {"result": "relinked"},
    }, {"source": b"new"}))

    snapshot = store.project_snapshot(handle)
    assert snapshot["revision"] == revision
    assert snapshot["source"]["fingerprint"] == "new"
    assert snapshot["frames"][0]["source_fingerprint"] == "new"
    assert snapshot["relink_history"][-1]["result"] == "relinked"
    store.close(handle)


@pytest.mark.parametrize("boundary", [
    "asset:source:before-write", "asset:source:after-fsync", "asset:source:after-replace",
    "metadata:before", "metadata:after", "catalog:before", "manifest:before-write", "manifest:after-replace",
])
def test_relink_fault_recovers_one_complete_source_identity(tmp_path, boundary):
    fault = FaultAt(boundary)
    store = ProjectStore(tmp_path, fault_hook=fault)
    handle = store.open()
    store.transact(handle, ProjectMutation(
        "register_source", {"id": "source", "filename": "old.mp4", "fingerprint": "old"}, {"source": b"old"},
    ))
    store.transact(handle, ProjectMutation("replace_frames", {"frames": [{"presentation_ordinal": 0, "source_fingerprint": "old"}]}))
    store.transact(handle, ProjectMutation(
        "save_frame_edit", {"id": "edit", "ordinal": 0, "document": {}}, {"render": b"render"},
    ))
    project_id = handle.project_id
    fault.armed = True
    with pytest.raises(RuntimeError):
        store.transact(handle, ProjectMutation("relink_source", {
            "id": "source", "filename": "new.mp4", "fingerprint": "new", "metadata": {},
            "frames": [{"presentation_ordinal": 0, "source_fingerprint": "new"}],
            "relink_attempt": {"result": "relinked"},
        }, {"source": b"new"}))
    store.close(handle)

    recovered = ProjectStore(tmp_path)
    reopened = recovered.open(project_id, "read")
    snapshot = recovered.project_snapshot(reopened)
    identity = snapshot["source"]["fingerprint"]
    assert identity in {"old", "new"}
    assert snapshot["frames"][0]["source_fingerprint"] == identity
    expected_asset = b"old" if identity == "old" else b"new"
    assert recovered.asset_path(reopened, snapshot["source"]["asset_hash"]).read_bytes() == expected_asset
    assert bool(snapshot["relink_history"]) is (identity == "new")
    recovered.close(reopened)


def test_restart_quarantines_hash_invalid_referenced_asset(tmp_path):
    store = ProjectStore(tmp_path)
    handle = store.open()
    store.transact(handle, ProjectMutation(
        "save_frame_edit", {"id": "edit-1", "ordinal": 0, "document": {}}, {"render": b"render"},
    ))
    project_id = handle.project_id
    render_hash = store.project_snapshot(handle)["frame_edits"][0]["render_hash"]
    store.asset_path(handle, render_hash).write_bytes(b"corrupt")
    store.close(handle)

    recovered = ProjectStore(tmp_path)
    assert recovered.lifecycle(None, "list") == []
    reopened = recovered.open(project_id, "read")
    with pytest.raises(IOError, match="integrity audit failed"):
        recovered.project_snapshot(reopened)
    recovered.close(reopened)


def test_restart_quarantines_corrupt_sqlite_without_blocking_healthy_projects(tmp_path):
    store = ProjectStore(tmp_path)
    broken = store.open(name="Broken")
    store.transact(broken, ProjectMutation(
        "save_frame_edit", {"id": "broken-edit", "ordinal": 0, "document": {}}, {"render": b"broken"},
    ))
    broken_id = broken.project_id
    broken_database = broken.path / "project.sqlite"
    store.close(broken)
    healthy = store.open(name="Healthy")
    store.transact(healthy, ProjectMutation(
        "save_frame_edit", {"id": "healthy-edit", "ordinal": 0, "document": {}}, {"render": b"healthy"},
    ))
    store.close(healthy)
    broken_database.write_bytes(b"not sqlite")

    recovered = ProjectStore(tmp_path)
    assert [project["name"] for project in recovered.lifecycle(None, "list")] == ["Healthy"]
    assert recovered.lifecycle(None, "recovery")[0]["id"] == broken_id
    assert recovered.lifecycle(None, "recovery")[0]["recovery_error"]


@pytest.mark.parametrize("boundary", ["metadata:before", "metadata:after", "catalog:before", "catalog:after", "manifest:before-write", "manifest:after-replace"])
@pytest.mark.parametrize("kind,mutation", [
    ("session", ProjectMutation("set_session_state", {"current_ordinal": 0, "trim_start_ordinal": 0, "trim_end_ordinal": 0})),
    ("rename", ProjectMutation("rename_project", {"name": "Renamed"})),
    ("delete", ProjectMutation("delete_frame_edit", {"id": "edit-1"})),
])
def test_metadata_only_mutations_recover_prior_or_new_semantic_state(tmp_path, boundary, kind, mutation):
    fault = FaultAt(boundary)
    store = ProjectStore(tmp_path, fault_hook=fault)
    handle = store.open(name="Before")
    store.transact(handle, ProjectMutation(
        "save_frame_edit", {"id": "edit-1", "ordinal": 0, "document": {}}, {"render": b"render"},
    ))
    project_id = handle.project_id
    fault.armed = True
    with pytest.raises(RuntimeError):
        store.transact(handle, mutation)
    store.close(handle)
    recovered = ProjectStore(tmp_path)
    reopened = recovered.open(project_id, "read")
    snapshot = recovered.project_snapshot(reopened)
    if kind == "session":
        assert snapshot["session_state"] in (None, {"current_ordinal": 0, "trim_start_ordinal": 0, "trim_end_ordinal": 0})
    elif kind == "rename":
        assert snapshot["name"] in {"Before", "Renamed"}
        assert json.loads((reopened.path / "manifest.json").read_text())["name"] == snapshot["name"]
    else:
        assert [edit["id"] for edit in snapshot["frame_edits"]] in (["edit-1"], [])
    recovered.close(reopened)
