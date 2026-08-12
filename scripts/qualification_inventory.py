"""Emit the exact runtime inventory used by the Phase 1 CI qualification."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
from pathlib import Path

import fastapi
import httpx
import numpy
import PIL
import pytest
import starlette


def version(*command: str, cwd: Path | None = None, all_lines: bool = False) -> str:
    executable = shutil.which(command[0]) or command[0]
    result = subprocess.run(
        (executable, *command[1:]),
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    lines = [line.strip() for line in (result.stdout or result.stderr).splitlines() if line.strip()]
    return " | ".join(lines) if all_lines else lines[0]


inventory = {
    "runner_os": os.environ.get("RUNNER_OS"),
    "image_os": os.environ.get("ImageOS"),
    "image_version": os.environ.get("ImageVersion"),
    "platform": platform.platform(),
    "python": platform.python_version(),
    "node": version("node", "--version"),
    "npm": version("npm", "--version"),
    "playwright": version("npx", "playwright", "--version", cwd=Path("web_app")),
    "chromium": version(
        "npx", "playwright", "install", "--list", cwd=Path("web_app"), all_lines=True
    ),
    "ffmpeg": version("ffmpeg", "-version"),
    "fastapi": fastapi.__version__,
    "starlette": starlette.__version__,
    "httpx": httpx.__version__,
    "pillow": PIL.__version__,
    "numpy": numpy.__version__,
    "pytest": pytest.__version__,
}
payload = json.dumps(inventory, sort_keys=True, separators=(",", ":"))
print(payload)
# Notices remain available through the public check-run annotations API even
# when raw workflow logs require repository authentication.
if os.environ.get("GITHUB_ACTIONS"):
    print(f"::notice title=Phase 1 qualification inventory::{payload}")
