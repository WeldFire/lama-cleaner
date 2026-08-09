"""Crash-safe local storage for persistent video frame-editing projects."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
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
        with sqlite3.connect(self._catalog) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                "CREATE TABLE IF NOT EXISTS projects ("
                "id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, "
                "updated_at TEXT NOT NULL, deleted_at TEXT)"
            )

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
                    "INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)",
                    (project_id, name, now, now),
                )
            self._write_manifest(project_path, project_id, name, 0)
        return ProjectHandle(project_id, project_path, connection, token, access_intent == "read")

    def transact(self, handle: ProjectHandle, mutation: ProjectMutation) -> int:
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
            catalog.execute("UPDATE projects SET updated_at=? WHERE id=?", (_now(), handle.project_id))
            name = catalog.execute("SELECT name FROM projects WHERE id=?", (handle.project_id,)).fetchone()[0]
        self._write_manifest(handle.path, handle.project_id, name, revision)
        return revision

    def lifecycle(self, project_id: str | None, command: str) -> Any:
        with sqlite3.connect(self._catalog) as connection:
            connection.row_factory = sqlite3.Row
            if command == "list":
                rows = connection.execute(
                    "SELECT id,name,created_at,updated_at FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC"
                ).fetchall()
                return [dict(row) for row in rows]
            if command not in {"trash", "restore"} or not project_id:
                raise ValueError(f"Unsupported lifecycle command: {command}")
            deleted_at = _now() if command == "trash" else None
            connection.execute("UPDATE projects SET deleted_at=?,updated_at=? WHERE id=?", (deleted_at, _now(), project_id))
            return {"project_id": project_id, "deleted": command == "trash"}

    def close(self, handle: ProjectHandle) -> None:
        handle.connection.close()

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

    @staticmethod
    def project_snapshot(handle: ProjectHandle) -> dict[str, Any]:
        source = handle.connection.execute("SELECT * FROM sources LIMIT 1").fetchone()
        frames = handle.connection.execute("SELECT ordinal,frame_key_json,png_hash FROM frames ORDER BY ordinal").fetchall()
        edits = handle.connection.execute("SELECT * FROM frame_edits WHERE deleted_at IS NULL ORDER BY ordinal").fetchall()
        session_row = handle.connection.execute("SELECT value FROM metadata WHERE key='session_state'").fetchone()
        return {
            "project_id": handle.project_id,
            "revision": int(handle.connection.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0]),
            "source": None if source is None else {**dict(source), "metadata": json.loads(source["metadata_json"])},
            "frames": [{**json.loads(row["frame_key_json"]), "png_hash": row["png_hash"]} for row in frames],
            "frame_edits": [{**dict(row), "document": json.loads(row["document_json"])} for row in edits],
            "session_state": None if session_row is None else json.loads(session_row["value"]),
        }
