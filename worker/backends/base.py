from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path


class BuildError(Exception):
    """A build failure with a message the site shows to the avatar's owner."""

    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


@dataclass
class Photo:
    slot: str
    path: Path
    width: int
    height: int


@dataclass
class BuildContext:
    build_id: str
    avatar_id: str
    asset_name: str
    options: dict
    photos: list[Photo]
    previous_likeness: float | None
    work_dir: Path
    cancelled: threading.Event = field(default_factory=threading.Event)

    def photos_in(self, slot: str) -> list[Photo]:
        return [p for p in self.photos if p.slot == slot]


@dataclass
class BuildResult:
    # Upload name (see RESULT_FILES in src/lib/worker-protocol.ts) -> local path.
    files: dict[str, Path]
    # Must contain "passed": True or the site rejects the build.
    rig_checks: dict
    likeness: float | None
    engine_version: str | None


def write_manifest(ctx: BuildContext, path: Path, backend: str, engine_version: str | None, rig_checks: dict, extra: dict | None = None) -> Path:
    manifest = {
        "schema": "slop.you/manifest@1",
        "avatarId": ctx.avatar_id,
        "buildId": ctx.build_id,
        "assetName": ctx.asset_name,
        "backend": backend,
        "engineVersion": engine_version,
        "options": ctx.options,
        "photoCount": len(ctx.photos),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "rig": {
            "body": "MetaHuman body skeleton",
            "face": "MetaHuman face rig (RigLogic, driven by the exported DNA)",
            "rigType": ctx.options.get("rigType"),
        },
        "rigChecks": rig_checks,
        "install": [
            f"Requires Unreal Engine {ctx.options.get('engine', '5.8')} or newer with the MetaHuman plugins enabled.",
            "Unzip ue-package.zip into your project's Content folder, keeping the folder structure.",
            f"The assembled character is in Content/MetaHumans/{ctx.asset_name}.",
        ],
        **(extra or {}),
    }
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return path
