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
from typing import Any, Callable, Mapping


SCHEMA_VERSION = 2
ORPHAN_GRACE_SECONDS = 24 * 60 * 60
LEASE_SECONDS = 30


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
    recovery_reason: str | None = None


@dataclass(frozen=True)
class ProjectMutation:
    kind: str
    payload: Mapping[str, Any]
    assets: Mapping[str, bytes] | None = None


class ProjectStore:
    """Own project SQLite, immutable assets, revisions, and lifecycle state."""

    def __init__(self, root: Path | None = None, fault_hook: Callable[[str], None] | None = None, *, instance_id: str | None = None, clock: Callable[[], float] | None = None):
        self.root = (root or default_project_data_dir()).resolve()
        self.projects_dir = self.root / "projects"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self._catalog = self.root / "catalog.sqlite"
        self._project_locks: dict[str, threading.RLock] = {}
        self._project_locks_guard = threading.Lock()
        self._fault_hook = fault_hook or (lambda boundary: None)
        self._instance_id = instance_id or str(uuid.uuid4())
        self._clock = clock or (lambda: datetime.now(timezone.utc).timestamp())
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
            if "recovery_error" not in columns:
                connection.execute("ALTER TABLE projects ADD COLUMN recovery_error TEXT")
            draft_candidates = [row[0] for row in connection.execute(
                "SELECT id FROM projects WHERE activated_at IS NULL"
            ).fetchall()]
            abandoned_drafts = []
            for project_id in draft_candidates:
                project_database = self.projects_dir / project_id / "project.sqlite"
                activated = None
                if project_database.exists():
                    try:
                        project = sqlite3.connect(project_database)
                        activated = project.execute(
                            "SELECT value FROM metadata WHERE key='activated_at'"
                        ).fetchone()
                    except sqlite3.DatabaseError:
                        # Recovery audit will classify the project; never treat
                        # unreadable metadata as proof that a draft is disposable.
                        activated = ("recovery-pending",)
                    finally:
                        if "project" in locals():
                            project.close()
                            del project
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
        self._adopt_uncataloged_projects()
        self._recover_projects()

    def open(
        self,
        project_locator: str | None = None,
        access_intent: str = "write",
        *,
        name: str = "Untitled video project",
        takeover: bool = False,
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
        database_path = project_path / "project.sqlite"
        connection = sqlite3.connect(database_path)
        connection.row_factory = sqlite3.Row
        lease_acquired = False
        if creating:
            try:
                self._fault_hook("creation:metadata:before")
            except Exception:
                connection.close()
                shutil.rmtree(project_path)
                raise
        # Compatibility is probed without mutation. Only supported schemas may
        # acquire a lease; the version is re-read under that lease by migration.
        if not creating:
            try:
                schema_row = connection.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()
                probed_version = int(schema_row[0]) if schema_row else 0
            except (sqlite3.DatabaseError, TypeError, ValueError) as error:
                connection.close()
                read_only = sqlite3.connect(f"file:{database_path.as_posix()}?mode=ro", uri=True)
                read_only.row_factory = sqlite3.Row
                return ProjectHandle(project_id, project_path, read_only, 0, True, f"Project metadata is incomplete or corrupt: {error}")
            if probed_version > SCHEMA_VERSION:
                connection.close()
                read_only = sqlite3.connect(f"file:{database_path.as_posix()}?mode=ro", uri=True)
                read_only.row_factory = sqlite3.Row
                return ProjectHandle(project_id, project_path, read_only, 0, True, f"Project schema {probed_version} is newer than supported schema {SCHEMA_VERSION}; opened read-only")
        if not creating and access_intent != "read":
            token = self._acquire_lease(connection, takeover)
            lease_acquired = True
            self._write_lease(project_path, token)
        recovery_reason = self._prepare_schema(connection, project_path, project_id, creating, access_intent)
        if recovery_reason:
            connection.close()
            read_only = sqlite3.connect(f"file:{database_path.as_posix()}?mode=ro", uri=True)
            read_only.row_factory = sqlite3.Row
            return ProjectHandle(project_id, project_path, read_only, 0, True, recovery_reason)
        self._initialize(connection, project_id)
        token = int(connection.execute("SELECT value FROM metadata WHERE key='fencing_token'").fetchone()[0])
        if access_intent != "read" and not lease_acquired:
            token = self._acquire_lease(connection, takeover)
            self._write_lease(project_path, token)
        if creating:
            try:
                self._fault_hook("creation:metadata:after")
            except Exception:
                connection.close()
                shutil.rmtree(project_path)
                raise
        if creating:
            now = _now()
            connection.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('project_name',?)", (name,))
            connection.commit()
            try:
                self._fault_hook("creation:catalog:before")
                with sqlite3.connect(self._catalog) as catalog:
                    catalog.execute(
                        "INSERT INTO projects(id,name,created_at,updated_at,activated_at) VALUES(?,?,?,?,NULL)",
                        (project_id, name, now, now),
                    )
                self._fault_hook("creation:catalog:after")
                self._write_manifest(project_path, project_id, name, 0)
            except Exception:
                connection.close()
                with sqlite3.connect(self._catalog) as catalog:
                    catalog.execute("DELETE FROM projects WHERE id=?", (project_id,))
                shutil.rmtree(project_path)
                raise
        return ProjectHandle(project_id, project_path, connection, token, access_intent == "read")

    def transact(self, handle: ProjectHandle, mutation: ProjectMutation) -> int:
        with self._project_lock(handle.project_id):
            if handle.read_only:
                raise PermissionError("Project is open read-only")
            connection = handle.connection
            asset_hashes = {
                name: self._ingest_asset(handle.path, data, name)
                for name, data in (mutation.assets or {}).items()
            }
            payload = dict(mutation.payload)
            payload["assets"] = asset_hashes
            self._fault_hook("metadata:before")
            connection.execute("BEGIN IMMEDIATE")
            try:
                current_token = int(connection.execute("SELECT value FROM metadata WHERE key='fencing_token'").fetchone()[0])
                owner = connection.execute("SELECT value FROM metadata WHERE key='lease_owner'").fetchone()
                if current_token != handle.fencing_token or not owner or owner[0] != self._instance_id:
                    raise PermissionError("This writer has been fenced by a newer project session")
                revision = int(connection.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0]) + 1
                self._apply_mutation(connection, mutation.kind, payload)
                connection.execute("UPDATE metadata SET value=? WHERE key='revision'", (str(revision),))
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            self._fault_hook("metadata:after")
            self._fault_hook("catalog:before")
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
            self._fault_hook("catalog:after")
            self._write_manifest(handle.path, handle.project_id, name, revision)
            return revision

    def lifecycle(self, project_id: str | None, command: str) -> Any:
        if command == "recovery":
            with sqlite3.connect(self._catalog) as connection:
                connection.row_factory = sqlite3.Row
                return [dict(row) for row in connection.execute(
                    "SELECT id,name,recovery_error FROM projects WHERE recovery_error IS NOT NULL ORDER BY id"
                )]
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
                    "WHERE deleted_at IS NULL AND activated_at IS NOT NULL AND recovery_error IS NULL ORDER BY updated_at DESC"
                ).fetchall()
                visible = []
                for row in rows:
                    database = self.projects_dir / row["id"] / "project.sqlite"
                    project = sqlite3.connect(database)
                    try:
                        integrity_error = project.execute(
                            "SELECT value FROM metadata WHERE key='integrity_error'"
                        ).fetchone()
                    finally:
                        project.close()
                    if not integrity_error:
                        visible.append(dict(row))
                return visible
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
        if not handle.read_only:
            try:
                handle.connection.execute("BEGIN IMMEDIATE")
                owner = handle.connection.execute("SELECT value FROM metadata WHERE key='lease_owner'").fetchone()
                token = int(handle.connection.execute("SELECT value FROM metadata WHERE key='fencing_token'").fetchone()[0])
                if owner and owner[0] == self._instance_id and token == handle.fencing_token:
                    handle.connection.execute("DELETE FROM metadata WHERE key IN ('lease_owner','lease_expires_at')")
                handle.connection.commit()
            except sqlite3.DatabaseError:
                handle.connection.rollback()
        handle.connection.close()

    def heartbeat(self, handle: ProjectHandle) -> None:
        """Renew the current instance lease without changing its fencing token."""
        if handle.read_only:
            raise PermissionError("Read-only projects do not own writer leases")
        self._fault_hook("lease:heartbeat:before")
        handle.connection.execute("BEGIN IMMEDIATE")
        try:
            owner = handle.connection.execute("SELECT value FROM metadata WHERE key='lease_owner'").fetchone()
            token = int(handle.connection.execute("SELECT value FROM metadata WHERE key='fencing_token'").fetchone()[0])
            if not owner or owner[0] != self._instance_id or token != handle.fencing_token:
                raise PermissionError("This writer lease has been fenced")
            handle.connection.execute(
                "INSERT OR REPLACE INTO metadata(key,value) VALUES('lease_expires_at',?)",
                (str(self._clock() + LEASE_SECONDS),),
            )
            handle.connection.commit()
        except Exception:
            handle.connection.rollback()
            raise
        self._fault_hook("lease:heartbeat:after-metadata")
        self._write_lease(handle.path, handle.fencing_token)

    def _acquire_lease(self, connection: sqlite3.Connection, takeover: bool) -> int:
        self._fault_hook("lease:acquire:before")
        connection.execute("BEGIN IMMEDIATE")
        try:
            token = int(connection.execute("SELECT value FROM metadata WHERE key='fencing_token'").fetchone()[0])
            lease_owner = connection.execute("SELECT value FROM metadata WHERE key='lease_owner'").fetchone()
            lease_expiry = connection.execute("SELECT value FROM metadata WHERE key='lease_expires_at'").fetchone()
            active_other = lease_owner and lease_owner[0] != self._instance_id and lease_expiry and float(lease_expiry[0]) > self._clock()
            if active_other and not takeover:
                raise PermissionError("Project is actively leased by another writer; reopen read-only or confirm takeover")
            if not lease_owner or lease_owner[0] != self._instance_id:
                token += 1
            connection.executemany("INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)", (
                ("fencing_token", str(token)), ("lease_owner", self._instance_id),
                ("lease_expires_at", str(self._clock() + LEASE_SECONDS)),
            ))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        self._fault_hook("lease:acquire:after")
        return token

    def _prepare_schema(self, connection: sqlite3.Connection, project_path: Path, project_id: str, creating: bool, access_intent: str) -> str | None:
        if creating:
            return None
        try:
            row = connection.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()
            version = int(row[0]) if row else 0
        except (sqlite3.DatabaseError, TypeError, ValueError) as error:
            return f"Project metadata is incomplete or corrupt: {error}"
        if version > SCHEMA_VERSION:
            return f"Project schema {version} is newer than supported schema {SCHEMA_VERSION}; opened read-only"
        if version < SCHEMA_VERSION:
            if access_intent == "read":
                return f"Project schema {version} requires migration; reopen with write access to migrate safely"
            backup = project_path / "backups" / f"schema-{version}.sqlite"
            backup.parent.mkdir(exist_ok=True)
            self._fault_hook("migration:backup:before")
            backup_connection = sqlite3.connect(backup)
            connection.backup(backup_connection)
            backup_connection.close()
            manifest = project_path / "manifest.json"
            if manifest.exists():
                shutil.copy2(manifest, backup.with_suffix(".manifest.json"))
            self._fault_hook("migration:backup:after")
            try:
                self._fault_hook("migration:transaction:before")
                with connection:
                    connection.execute("UPDATE metadata SET value=? WHERE key='schema_version'", (str(SCHEMA_VERSION),))
                    connection.execute("CREATE TABLE IF NOT EXISTS schema_history(from_version INTEGER,to_version INTEGER,migrated_at TEXT)")
                    connection.execute("INSERT INTO schema_history VALUES(?,?,?)", (version, SCHEMA_VERSION, _now()))
                self._fault_hook("migration:transaction:after")
                if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise sqlite3.DatabaseError("Post-migration SQLite integrity audit failed")
                referenced = [row[0] for query in (
                    "SELECT asset_hash FROM sources", "SELECT png_hash FROM frames WHERE png_hash IS NOT NULL",
                    "SELECT render_hash FROM frame_edits WHERE render_hash IS NOT NULL", "SELECT mask_hash FROM frame_edits WHERE mask_hash IS NOT NULL",
                ) for row in connection.execute(query)]
                if any(
                    not (project_path / "assets" / digest[:2] / digest).exists()
                    or hashlib.sha256((project_path / "assets" / digest[:2] / digest).read_bytes()).hexdigest() != digest
                    for digest in referenced
                ):
                    raise IOError("Post-migration asset integrity audit failed")
            except Exception:
                connection.close()
                for suffix in ("-wal", "-shm"):
                    (project_path / f"project.sqlite{suffix}").unlink(missing_ok=True)
                restored = sqlite3.connect(project_path / "project.sqlite")
                backup_connection = sqlite3.connect(backup)
                backup_connection.backup(restored)
                backup_connection.close()
                restored.close()
                raise
        return None

    def _write_lease(self, project_path: Path, token: int) -> None:
        self._fault_hook("lease:file:before")
        temporary = project_path / "tmp" / f"writer-lease.{self._instance_id}.{token}.{uuid.uuid4().hex}.tmp"
        payload = {"instance_id": self._instance_id, "fencing_token": token, "expires_at": self._clock() + LEASE_SECONDS}
        temporary.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
        verification = sqlite3.connect(project_path / "project.sqlite")
        try:
            verification.execute("BEGIN IMMEDIATE")
            owner = verification.execute("SELECT value FROM metadata WHERE key='lease_owner'").fetchone()
            current_token = int(verification.execute("SELECT value FROM metadata WHERE key='fencing_token'").fetchone()[0])
            if not owner or owner[0] != self._instance_id or current_token != token:
                verification.rollback()
                temporary.unlink(missing_ok=True)
                return
            os.replace(temporary, project_path / "writer-lease.json")
            verification.commit()
        finally:
            verification.close()
        self._fault_hook("lease:file:after")

    def _recover_projects(self) -> None:
        """Audit durable project state and repair derived catalog/manifest files."""
        for project_path in self.projects_dir.iterdir():
            database = project_path / "project.sqlite"
            if not project_path.is_dir() or not database.exists():
                continue
            try:
                connection = sqlite3.connect(database)
                connection.row_factory = sqlite3.Row
                integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
                if integrity != "ok":
                    raise sqlite3.DatabaseError(f"SQLite integrity check failed: {integrity}")
                now = datetime.now(timezone.utc).timestamp()
                for temporary in (project_path / "tmp").glob("*"):
                    if now - temporary.stat().st_mtime >= ORPHAN_GRACE_SECONDS:
                        try:
                            self._fault_hook("cleanup:temporary")
                            temporary.unlink(missing_ok=True)
                        except OSError:
                            # Cleanup is best effort; a locked orphan cannot make
                            # an otherwise complete project unavailable.
                            pass
                metadata = {row["key"]: row["value"] for row in connection.execute("SELECT key,value FROM metadata")}
                source_hashes = {
                    row[0] for row in connection.execute("SELECT asset_hash FROM sources")
                }
                referenced = {
                    row[0]
                    for query in (
                        "SELECT png_hash FROM frames WHERE png_hash IS NOT NULL",
                        "SELECT render_hash FROM frame_edits WHERE render_hash IS NOT NULL",
                        "SELECT mask_hash FROM frame_edits WHERE mask_hash IS NOT NULL",
                    )
                    for row in connection.execute(query)
                }
                invalid = []
                for digest in referenced:
                    asset = project_path / "assets" / digest[:2] / digest
                    if not asset.exists() or hashlib.sha256(asset.read_bytes()).hexdigest() != digest:
                        invalid.append(digest)
                for digest in source_hashes:
                    asset = project_path / "assets" / digest[:2] / digest
                    if asset.exists() and hashlib.sha256(asset.read_bytes()).hexdigest() != digest:
                        invalid.append(digest)
                if invalid:
                    connection.execute(
                        "INSERT OR REPLACE INTO metadata(key,value) VALUES('integrity_error',?)",
                        (json.dumps({"invalid_assets": sorted(invalid)}),),
                    )
                    connection.commit()
                    continue
                # A missing immutable Trim Input is recoverable through the
                # fingerprint-verified relink flow. Authored frame assets are
                # not, so only those put the project into integrity recovery.
                missing_sources = [
                    digest
                    for digest in source_hashes
                    if not (project_path / "assets" / digest[:2] / digest).exists()
                ]
                if missing_sources:
                    connection.execute(
                        "INSERT OR REPLACE INTO metadata(key,value) VALUES('source_relink_required',?)",
                        (json.dumps({"missing_assets": sorted(missing_sources)}),),
                    )
                else:
                    connection.execute("DELETE FROM metadata WHERE key='source_relink_required'")
                connection.execute("DELETE FROM metadata WHERE key='integrity_error'")
                connection.commit()
                referenced.update(source_hashes)
                for asset in (project_path / "assets").glob("*/*"):
                    if asset.is_file() and asset.name not in referenced and now - asset.stat().st_mtime >= ORPHAN_GRACE_SECONDS:
                        try:
                            self._fault_hook("cleanup:orphan-asset")
                            asset.unlink(missing_ok=True)
                        except OSError:
                            pass
                revision = int(metadata.get("revision", "0"))
                with sqlite3.connect(self._catalog) as catalog:
                    row = catalog.execute("SELECT name FROM projects WHERE id=?", (project_path.name,)).fetchone()
                    name = metadata.get("project_name") or (row[0] if row else "Untitled video project")
                    if row:
                        catalog.execute(
                            "UPDATE projects SET name=?,activated_at=COALESCE(activated_at,?),recovery_error=NULL WHERE id=?",
                            (name, metadata.get("activated_at"), project_path.name),
                        )
                self._write_manifest(project_path, project_path.name, name, revision)
            except (OSError, sqlite3.DatabaseError, ValueError) as error:
                with sqlite3.connect(self._catalog) as catalog:
                    catalog.execute("UPDATE projects SET recovery_error=? WHERE id=?", (str(error), project_path.name))
            finally:
                if "connection" in locals():
                    connection.close()
                    del connection

    def _adopt_uncataloged_projects(self) -> None:
        """Rebuild catalog rows from self-contained project directories."""
        with sqlite3.connect(self._catalog) as catalog:
            catalog_ids = {row[0] for row in catalog.execute("SELECT id FROM projects")}
            for project_path in self.projects_dir.iterdir():
                database = project_path / "project.sqlite"
                if not project_path.is_dir() or project_path.name in catalog_ids or not database.exists():
                    continue
                try:
                    project = sqlite3.connect(database)
                    metadata = {row[0]: row[1] for row in project.execute("SELECT key,value FROM metadata")}
                    project.close()
                    if metadata.get("project_id") != project_path.name:
                        continue
                    now = _now()
                    catalog.execute(
                        "INSERT INTO projects(id,name,created_at,updated_at,activated_at,deleted_at,recovery_error) VALUES(?,?,?,?,?,NULL,NULL)",
                        (project_path.name, metadata.get("project_name", "Recovered project"), now, now, metadata.get("activated_at")),
                    )
                except sqlite3.DatabaseError:
                    # Unknown/corrupt directories are left untouched for manual
                    # recovery; startup never destroys potentially authored data.
                    continue

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
            if payload.get("relink_attempt"):
                current = connection.execute("SELECT value FROM metadata WHERE key='relink_history'").fetchone()
                history = json.loads(current[0]) if current else []
                history.append(payload["relink_attempt"])
                connection.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('relink_history',?)", (json.dumps(history, sort_keys=True),))
        elif kind == "relink_source":
            connection.execute(
                "INSERT OR REPLACE INTO sources(id,filename,fingerprint,asset_hash,metadata_json) VALUES(?,?,?,?,?)",
                (payload["id"], payload["filename"], payload["fingerprint"], assets["source"], json.dumps(payload["metadata"], sort_keys=True)),
            )
            connection.execute("DELETE FROM frames")
            connection.executemany(
                "INSERT INTO frames(ordinal,frame_key_json,png_hash) VALUES(?,?,?)",
                ((frame["presentation_ordinal"], json.dumps({key: value for key, value in frame.items() if key != "png_hash"}, sort_keys=True), frame.get("png_hash")) for frame in payload["frames"]),
            )
            current = connection.execute("SELECT value FROM metadata WHERE key='relink_history'").fetchone()
            attempts = json.loads(current[0]) if current else []
            attempts.append(payload["relink_attempt"])
            connection.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('relink_history',?)", (json.dumps(attempts, sort_keys=True),))
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
        elif kind == "record_relink_attempt":
            current = connection.execute("SELECT value FROM metadata WHERE key='relink_history'").fetchone()
            history = json.loads(current[0]) if current else []
            history.append(payload["attempt"])
            connection.execute(
                "INSERT OR REPLACE INTO metadata(key,value) VALUES('relink_history',?)",
                (json.dumps(history, sort_keys=True),),
            )
        elif kind == "rename_project":
            # The display name is catalog metadata. The transaction still
            # advances the project revision so the manifest and catalog move
            # forward together under the writer's fencing token.
            connection.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('project_name',?)", (payload["name"],))
        else:
            raise ValueError(f"Unsupported project mutation: {kind}")

    def _ingest_asset(self, project_path: Path, data: bytes, asset_name: str) -> str:
        digest = hashlib.sha256(data).hexdigest()
        destination = project_path / "assets" / digest[:2] / digest
        if destination.exists():
            if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
                raise IOError(f"Existing {asset_name} asset failed hash verification")
            return digest
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = project_path / "tmp" / f"{digest}.{uuid.uuid4().hex}.tmp"
        self._fault_hook(f"asset:{asset_name}:before-write")
        with temporary.open("xb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        self._fault_hook(f"asset:{asset_name}:after-fsync")
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
            temporary.unlink(missing_ok=True)
            raise IOError("Asset hash verification failed")
        os.replace(temporary, destination)
        self._fault_hook(f"asset:{asset_name}:after-replace")
        return digest

    def _write_manifest(self, project_path: Path, project_id: str, name: str, revision: int) -> None:
        payload = {"project_id": project_id, "name": name, "schema_version": SCHEMA_VERSION, "revision": revision}
        temporary = project_path / "tmp" / "manifest.json.tmp"
        self._fault_hook("manifest:before-write")
        with temporary.open("w", encoding="utf-8") as output:
            json.dump(payload, output, sort_keys=True, indent=2)
            output.flush()
            os.fsync(output.fileno())
        self._fault_hook("manifest:after-fsync")
        os.replace(temporary, project_path / "manifest.json")
        self._fault_hook("manifest:after-replace")

    @staticmethod
    def asset_path(handle: ProjectHandle, digest: str) -> Path:
        return handle.path / "assets" / digest[:2] / digest

    def project_snapshot(self, handle: ProjectHandle) -> dict[str, Any]:
        integrity_row = handle.connection.execute("SELECT value FROM metadata WHERE key='integrity_error'").fetchone()
        if integrity_row:
            raise IOError(f"Project integrity audit failed: {integrity_row['value']}")
        source = handle.connection.execute("SELECT * FROM sources LIMIT 1").fetchone()
        frames = handle.connection.execute("SELECT ordinal,frame_key_json,png_hash FROM frames ORDER BY ordinal").fetchall()
        edits = handle.connection.execute("SELECT * FROM frame_edits WHERE deleted_at IS NULL ORDER BY ordinal").fetchall()
        session_row = handle.connection.execute("SELECT value FROM metadata WHERE key='session_state'").fetchone()
        activation_row = handle.connection.execute("SELECT value FROM metadata WHERE key='activated_at'").fetchone()
        relink_row = handle.connection.execute("SELECT value FROM metadata WHERE key='relink_history'").fetchone()
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
            "relink_history": [] if relink_row is None else json.loads(relink_row["value"]),
        }
