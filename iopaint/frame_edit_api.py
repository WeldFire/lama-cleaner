"""FastAPI boundary for persistent exact-frame editing projects."""

from __future__ import annotations

import json
import subprocess
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from iopaint.frame_media import FrameMediaError, build_frame_table, extract_canonical_png, source_fingerprint
from iopaint.project_store import ProjectMutation, ProjectStore
from iopaint.video import MAX_VIDEO_BYTES, SUPPORTED_VIDEO_EXTENSIONS


class FrameEditApi:
    def __init__(self, store: ProjectStore | None = None):
        self.store = store or ProjectStore()
        self.router = APIRouter(prefix="/api/v1/projects", tags=["frame editing"])
        self.router.add_api_route("", self.create_project, methods=["POST"])
        self.router.add_api_route("", self.list_projects, methods=["GET"])
        self.router.add_api_route("/{project_id}", self.get_project, methods=["GET"])
        self.router.add_api_route("/{project_id}/frames", self.list_frames, methods=["GET"])
        self.router.add_api_route("/{project_id}/frames/{ordinal}/image", self.frame_image, methods=["GET"])
        self.router.add_api_route("/{project_id}/frame-edits", self.list_frame_edits, methods=["GET"])
        self.router.add_api_route("/{project_id}/frame-edits", self.save_frame_edit, methods=["POST"])
        self.router.add_api_route("/{project_id}/frame-edits/{frame_edit_id}", self.delete_frame_edit, methods=["DELETE"])

    def create_project(self, file: UploadFile = File(...), name: str = Form("Untitled video project")):
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in SUPPORTED_VIDEO_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Choose an MP4, MOV, or WebM video.")
        data = file.file.read(MAX_VIDEO_BYTES + 1)
        if not data or len(data) > MAX_VIDEO_BYTES:
            raise HTTPException(status_code=400, detail="Choose a non-empty video no larger than 2 GB.")
        handle = self.store.open(name=name)
        try:
            fingerprint = source_fingerprint(data)
            source_id = str(uuid.uuid4())
            self.store.transact(handle, ProjectMutation(
                "register_source",
                {"id": source_id, "filename": Path(file.filename or f"source{suffix}").name, "fingerprint": fingerprint},
                {"source": data},
            ))
            snapshot = self.store.project_snapshot(handle)
            source_path = self.store.asset_path(handle, snapshot["source"]["asset_hash"])
            metadata, frames = build_frame_table(source_path, fingerprint)
            # Store probe metadata on the source and then the complete frame table.
            self.store.transact(handle, ProjectMutation(
                "register_source",
                {"id": source_id, "filename": snapshot["source"]["filename"], "fingerprint": fingerprint, "metadata": metadata},
                {"source": data},
            ))
            self.store.transact(handle, ProjectMutation("replace_frames", {"frames": frames}))
            return self.store.project_snapshot(handle)
        except (FrameMediaError, FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            self.store.lifecycle(handle.project_id, "trash")
            raise HTTPException(status_code=422, detail="Unable to build an exact frame index for this video.") from error
        finally:
            self.store.close(handle)

    def list_projects(self):
        return self.store.lifecycle(None, "list")

    def get_project(self, project_id: str):
        return self._snapshot(project_id)

    def list_frames(self, project_id: str):
        return self._snapshot(project_id)["frames"]

    def list_frame_edits(self, project_id: str):
        return self._snapshot(project_id)["frame_edits"]

    def frame_image(self, project_id: str, ordinal: int):
        handle = self._open(project_id, "write")
        try:
            snapshot = self.store.project_snapshot(handle)
            try:
                frame = snapshot["frames"][ordinal]
            except IndexError as error:
                raise HTTPException(status_code=404, detail="Frame not found") from error
            if frame["presentation_ordinal"] != ordinal:
                raise HTTPException(status_code=404, detail="Frame not found")
            digest = frame.get("png_hash")
            if not digest:
                source_path = self.store.asset_path(handle, snapshot["source"]["asset_hash"])
                with tempfile.TemporaryDirectory(prefix="iopaint-frame-") as directory:
                    output = Path(directory) / "frame.png"
                    extract_canonical_png(source_path, frame, output)
                    data = output.read_bytes()
                self.store.transact(handle, ProjectMutation("set_frame_png", {"ordinal": ordinal}, {"png": data}))
                digest = self.store.project_snapshot(handle)["frames"][ordinal]["png_hash"]
            return FileResponse(self.store.asset_path(handle, digest), media_type="image/png", filename=f"frame-{ordinal}.png")
        except (FrameMediaError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
            raise HTTPException(status_code=422, detail="Unable to extract this canonical frame.") from error
        finally:
            self.store.close(handle)

    def save_frame_edit(
        self,
        project_id: str,
        ordinal: int = Form(...),
        document: str = Form("{}"),
        frame_edit_id: str | None = Form(None),
        render: UploadFile = File(...),
        mask: UploadFile | None = File(None),
    ):
        try:
            document_payload = json.loads(document)
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=400, detail="Frame edit document must be valid JSON") from error
        handle = self._open(project_id, "write")
        try:
            snapshot = self.store.project_snapshot(handle)
            if ordinal < 0 or ordinal >= len(snapshot["frames"]):
                raise HTTPException(status_code=404, detail="Frame not found")
            assets = {"render": render.file.read()}
            if mask is not None:
                assets["mask"] = mask.file.read()
            edit_id = frame_edit_id or str(uuid.uuid4())
            self.store.transact(handle, ProjectMutation(
                "save_frame_edit", {"id": edit_id, "ordinal": ordinal, "document": document_payload}, assets,
            ))
            return next(edit for edit in self.store.project_snapshot(handle)["frame_edits"] if edit["id"] == edit_id)
        finally:
            self.store.close(handle)

    def delete_frame_edit(self, project_id: str, frame_edit_id: str):
        handle = self._open(project_id, "write")
        try:
            self.store.transact(handle, ProjectMutation("delete_frame_edit", {"id": frame_edit_id}))
            return {"id": frame_edit_id, "deleted": True}
        finally:
            self.store.close(handle)

    def _snapshot(self, project_id: str):
        handle = self._open(project_id, "read")
        try:
            return self.store.project_snapshot(handle)
        finally:
            self.store.close(handle)

    def _open(self, project_id: str, intent: str):
        try:
            return self.store.open(project_id, intent)
        except FileNotFoundError as error:
            raise HTTPException(status_code=404, detail="Project not found") from error
