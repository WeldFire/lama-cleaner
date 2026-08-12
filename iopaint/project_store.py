"""Crash-safe local storage for persistent video frame-editing projects."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import sys
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


SCHEMA_VERSION = 1


def default_project_data_dir() -> Path:
    configured = os.environ.get("PROJECT_DATA_DIR")
    if configured:
        return Path(configured).expanduser()
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "IOPaint" / "projects"
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/IOPaint/projects"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "iopaint" / "projects"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class ProjectHandle:
    project_id: str
    path: Path
    connection: sqlite3.Connection
    fencing_token: int
    read_only: bool = False


@dataclass(frozen=True)
class ProjectMutation:
    kind: str
    payload: Mapping[str, Any]
    assets: Mapping[str, bytes] | None = None


class ProjectStore:
    """Own project SQLite, immutable assets, revisions, and lifecycle state."""

    def __init__(self, root: Path | None = None):
        self.root = (root or default_project_data_dir()).resolve()
        self.projects_dir = self.root / "projects"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self._catalog = self.root / "catalog.sqlite"
        self._project_locks: dict[str, threading.RLock] = {}
        self._project_locks_guard = threading.Lock()
        with sqlite3.connect(self._catalog) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                "CREATE TABLE IF NOT EXISTS projects ("
                "id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, "
                "updated_at TEXT NOT NULL, activated_at TEXT, deleted_at TEXT)"
            )
            columns = {row[1] for row in connection.execute("PRAGMA table_info(projects)")}
            if "activated_at" not in columns:
                connection.execute("ALTER TABLE projects ADD COLUMN activated_at TEXT")
                connection.execute("UPDATE projects SET activated_at=created_at WHERE activated_at IS NULL")
            draft_candidates = [row[0] for row in connection.execute(
                "SELECT id FROM projects WHERE activated_at IS NULL"
            ).fetchall()]
            abandoned_drafts = []
            for project_id in draft_candidates:
                project_database = self.projects_dir / project_id / "project.sqlite"
                activated = None
                if project_database.exists():
                    project = sqlite3.connect(project_database)
                    try:
                        activated = project.execute(
                            "SELECT value FROM metadata WHERE key='activated_at'"
                        ).fetchone()
                    finally:
                        project.close()
                if activated:
                    connection.execute(
                        "UPDATE projects SET activated_at=? WHERE id=?",
                        (activated[0], project_id),
                    )
                else:
                    abandoned_drafts.append(project_id)
            connection.executemany("DELETE FROM projects WHERE id=?", ((project_id,) for project_id in abandoned_drafts))
        for project_id in abandoned_drafts:
            # Drafts are disposable preparation state. A backend restart is a
            # hard session boundary, so remove their source assets as well.
            shutil.rmtree(self.projects_dir / project_id, ignore_errors=True)

    def open(
        self,
        project_locator: str | None = None,
        access_intent: str = "write",
        *,
        name: str = "Untitled video project",
    ) -> ProjectHandle:
        if project_locator is None:
            project_id = str(uuid.uuid4())
        else:
            # Project locators cross an HTTP boundary; only canonical IDs may
            # participate in filesystem path construction.
            try:
                project_id = str(uuid.UUID(project_locator))
            except (ValueError, AttributeError) as error:
                raise FileNotFoundError(project_locator) from error
        project_path = self.projects_dir / project_id
        creating = not (project_path / "project.sqlite").exists()
        if creating and access_intent == "read":
            raise FileNotFoundError(project_id)
        project_path.mkdir(parents=True, exist_ok=True)
        for child in ("assets", "cache", "tmp"):
            (project_path / child).mkdir(exist_ok=True)
        connection = sqlite3.connect(project_path / "project.sqlite")
        connection.row_factory = sqlite3.Row
        self._initialize(connection, project_id)
        token = int(connection.execute("SELECT value FROM metadata WHERE key='fencing_token'").fetchone()[0])
        if access_intent != "read":
            token += 1
            connection.execute("UPDATE metadata SET value=? WHERE key='fencing_token'", (str(token),))
            connection.commit()
        if creating:
            now = _now()
            with sqlite3.connect(self._catalog) as catalog:
                catalog.execute(
                    "INSERT INTO projects(id,name,created_at,updated_at,activated_at) VALUES(?,?,?,?,NULL)",
                    (project_id, name, now, now),
                )
            self._write_manifest(project_path, project_id, name, 0)
        return ProjectHandle(project_id, project_path, connection, token, access_intent == "read")

    def transact(self, handle: ProjectHandle, mutation: ProjectMutation) -> int:
        with self._project_lock(handle.project_id):
            if handle.read_only:
                raise PermissionError("Project is open read-only")
            connection = handle.connection
            current_token = int(connection.execute("SELECT value FROM metadata WHERE key='fencing_token'").fetchone()[0])
            if current_token != handle.fencing_token:
                raise PermissionError("This writer has been fenced by a newer project session")
            asset_hashes = {name: self._ingest_asset(handle.path, data) for name, data in (mutation.assets or {}).items()}
            payload = dict(mutation.payload)
            payload["assets"] = asset_hashes
            with connection:
                revision = int(connection.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0]) + 1
                self._apply_mutation(connection, mutation.kind, payload)
                connection.execute("UPDATE metadata SET value=? WHERE key='revision'", (str(revision),))
            with sqlite3.connect(self._catalog) as catalog:
                if mutation.kind == "rename_project":
                    catalog.execute(
                        "UPDATE projects SET name=? WHERE id=?",
                        (payload["name"], handle.project_id),
                    )
                if mutation.kind == "save_frame_edit":
                    # A project becomes user-visible only once it owns durable work.
                    catalog.execute(
                        "UPDATE projects SET activated_at=COALESCE(activated_at,?) WHERE id=?",
                        (_now(), handle.project_id),
                    )
                catalog.execute("UPDATE projects SET updated_at=? WHERE id=?", (_now(), handle.project_id))
                name = catalog.execute("SELECT name FROM projects WHERE id=?", (handle.project_id,)).fetchone()[0]
            self._write_manifest(handle.path, handle.project_id, name, revision)
            return revision

    def lifecycle(self, project_id: str | None, command: str) -> Any:
        if command == "discard-draft":
            if not project_id:
                raise ValueError("Draft discard requires a project ID")
            return self._discard_draft(project_id)
        with sqlite3.connect(self._catalog) as connection:
            connection.row_factory = sqlite3.Row
            if command == "list":
                # `activated_at` in the project database is authoritative and
                # commits with the first Frame Edit. Repair the catalog cache
                # if a process stopped between that commit and catalog update.
                for row in connection.execute(
                    "SELECT id FROM projects WHERE deleted_at IS NULL AND activated_at IS NULL"
                ).fetchall():
                    project_database = self.projects_dir / row["id"] / "project.sqlite"
                    if not project_database.exists():
                        continue
                    project = sqlite3.connect(project_database)
                    try:
                        activated = project.execute(
                            "SELECT value FROM metadata WHERE key='activated_at'"
                        ).fetchone()
                    finally:
                        project.close()
                    if activated:
                        connection.execute(
                            "UPDATE projects SET activated_at=? WHERE id=?",
                            (activated[0], row["id"]),
                        )
                rows = connection.execute(
                    "SELECT id,name,created_at,updated_at FROM projects "
                    "WHERE deleted_at IS NULL AND activated_at IS NOT NULL ORDER BY updated_at DESC"
                ).fetchall()
                return [dict(row) for row in rows]
            if command not in {"trash", "restore"} or not project_id:
                raise ValueError(f"Unsupported lifecycle command: {command}")
            row = connection.execute("SELECT activated_at FROM projects WHERE id=?", (project_id,)).fetchone()
            if command == "trash" and row and row["activated_at"] is None:
                connection.execute("DELETE FROM projects WHERE id=?", (project_id,))
                shutil.rmtree(self.projects_dir / project_id, ignore_errors=True)
                return {"project_id": project_id, "deleted": True}
            deleted_at = _now() if command == "trash" else None
            connection.execute("UPDATE projects SET deleted_at=?,updated_at=? WHERE id=?", (deleted_at, _now(), project_id))
            return {"project_id": project_id, "deleted": command == "trash"}

    def close(self, handle: ProjectHandle) -> None:
        handle.connection.close()

    def _project_lock(self, project_id: str) -> threading.RLock:
        with self._project_locks_guard:
            return self._project_locks.setdefault(project_id, threading.RLock())

    def _discard_draft(self, project_id: str) -> dict[str, Any]:
        with self._project_lock(project_id), sqlite3.connect(self._catalog) as catalog:
            catalog.row_factory = sqlite3.Row
            row = catalog.execute("SELECT activated_at FROM projects WHERE id=?", (project_id,)).fetchone()
            if not row or row["activated_at"] is not None:
                return {"project_id": project_id, "deleted": False}
            project_database = self.projects_dir / project_id / "project.sqlite"
            if project_database.exists():
                project = sqlite3.connect(project_database)
                try:
                    activated = project.execute(
                        "SELECT value FROM metadata WHERE key='activated_at'"
                    ).fetchone()
                finally:
                    project.close()
                if activated:
                    catalog.execute(
                        "UPDATE projects SET activated_at=? WHERE id=?",
                        (activated[0], project_id),
                    )
                    return {"project_id": project_id, "deleted": False}
            catalog.execute("DELETE FROM projects WHERE id=?", (project_id,))
            shutil.rmtree(self.projects_dir / project_id, ignore_errors=True)
            return {"project_id": project_id, "deleted": True}

    @staticmethod
    def _initialize(connection: sqlite3.Connection, project_id: str) -> None:
        connection.executescript(
            "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;"
            "CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);"
            "CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,filename TEXT NOT NULL,fingerprint TEXT NOT NULL,asset_hash TEXT NOT NULL,metadata_json TEXT NOT NULL);"
            "CREATE TABLE IF NOT EXISTS frames(ordinal INTEGER PRIMARY KEY,frame_key_json TEXT NOT NULL,png_hash TEXT);"
            "CREATE TABLE IF NOT EXISTS frame_edits(id TEXT PRIMARY KEY,ordinal INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,document_json TEXT NOT NULL,render_hash TEXT,mask_hash TEXT,deleted_at TEXT);"
        )
        connection.executemany(
            "INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)",
            (("schema_version", str(SCHEMA_VERSION)), ("project_id", project_id), ("revision", "0"), ("fencing_token", "0")),
        )
        connection.commit()

    @staticmethod
    def _apply_mutation(connection: sqlite3.Connection, kind: str, payload: Mapping[str, Any]) -> None:
        assets = payload.get("assets", {})
        if kind == "register_source":
            connection.execute(
                "INSERT OR REPLACE INTO sources(id,filename,fingerprint,asset_hash,metadata_json) VALUES(?,?,?,?,?)",
                (payload["id"], payload["filename"], payload["fingerprint"], assets["source"], json.dumps(payload.get("metadata", {}), sort_keys=True)),
            )
        elif kind == "replace_frames":
            connection.execute("DELETE FROM frames")
            connection.executemany(
                "INSERT INTO frames(ordinal,frame_key_json) VALUES(?,?)",
                ((frame["presentation_ordinal"], json.dumps(frame, sort_keys=True)) for frame in payload["frames"]),
            )
        elif kind == "set_frame_png":
            connection.execute("UPDATE frames SET png_hash=? WHERE ordinal=?", (assets["png"], payload["ordinal"]))
        elif kind == "save_frame_edit":
            now = _now()
            connection.execute(
                "INSERT INTO frame_edits(id,ordinal,created_at,updated_at,document_json,render_hash,mask_hash) VALUES(?,?,?,?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET ordinal=excluded.ordinal,updated_at=excluded.updated_at,document_json=excluded.document_json,render_hash=excluded.render_hash,mask_hash=excluded.mask_hash,deleted_at=NULL",
                (payload["id"], payload["ordinal"], now, now, json.dumps(payload.get("document", {}), sort_keys=True), assets.get("render"), assets.get("mask")),
            )
            connection.execute(
                "INSERT OR IGNORE INTO metadata(key,value) VALUES('activated_at',?)",
                (now,),
            )
        elif kind == "delete_frame_edit":
            connection.execute("UPDATE frame_edits SET deleted_at=?,updated_at=? WHERE id=?", (_now(), _now(), payload["id"]))
        elif kind == "set_session_state":
            session_state = {
                "current_ordinal": int(payload["current_ordinal"]),
                "trim_start_ordinal": int(payload["trim_start_ordinal"]),
                "trim_end_ordinal": int(payload["trim_end_ordinal"]),
            }
            connection.execute(
                "INSERT OR REPLACE INTO metadata(key,value) VALUES('session_state',?)",
                (json.dumps(session_state, sort_keys=True),),
            )
        elif kind == "rename_project":
            # The display name is catalog metadata. The transaction still
            # advances the project revision so the manifest and catalog move
            # forward together under the writer's fencing token.
            pass
        else:
            raise ValueError(f"Unsupported project mutation: {kind}")

    @staticmethod
    def _ingest_asset(project_path: Path, data: bytes) -> str:
        digest = hashlib.sha256(data).hexdigest()
        destination = project_path / "assets" / digest[:2] / digest
        if destination.exists():
            return digest
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = project_path / "tmp" / f"{digest}.{uuid.uuid4().hex}.tmp"
        with temporary.open("xb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
            temporary.unlink(missing_ok=True)
            raise IOError("Asset hash verification failed")
        os.replace(temporary, destination)
        return digest

    @staticmethod
    def _write_manifest(project_path: Path, project_id: str, name: str, revision: int) -> None:
        payload = {"project_id": project_id, "name": name, "schema_version": SCHEMA_VERSION, "revision": revision}
        temporary = project_path / "tmp" / "manifest.json.tmp"
        with temporary.open("w", encoding="utf-8") as output:
            json.dump(payload, output, sort_keys=True, indent=2)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, project_path / "manifest.json")

    @staticmethod
    def asset_path(handle: ProjectHandle, digest: str) -> Path:
        return handle.path / "assets" / digest[:2] / digest

    def project_snapshot(self, handle: ProjectHandle) -> dict[str, Any]:
        source = handle.connection.execute("SELECT * FROM sources LIMIT 1").fetchone()
        frames = handle.connection.execute("SELECT ordinal,frame_key_json,png_hash FROM frames ORDER BY ordinal").fetchall()
        edits = handle.connection.execute("SELECT * FROM frame_edits WHERE deleted_at IS NULL ORDER BY ordinal").fetchall()
        session_row = handle.connection.execute("SELECT value FROM metadata WHERE key='session_state'").fetchone()
        activation_row = handle.connection.execute("SELECT value FROM metadata WHERE key='activated_at'").fetchone()
        with sqlite3.connect(self._catalog) as catalog:
            catalog_row = catalog.execute("SELECT name,activated_at FROM projects WHERE id=?", (handle.project_id,)).fetchone()
        return {
            "project_id": handle.project_id,
            "name": catalog_row[0] if catalog_row else "Untitled video project",
            "durable": bool(activation_row or (catalog_row and catalog_row[1])),
            "revision": int(handle.connection.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0]),
            "source": None if source is None else {**dict(source), "metadata": json.loads(source["metadata_json"])},
            "frames": [{**json.loads(row["frame_key_json"]), "png_hash": row["png_hash"]} for row in frames],
            "frame_edits": [{**dict(row), "document": json.loads(row["document_json"])} for row in edits],
            "session_state": None if session_row is None else json.loads(session_row["value"]),
        }
