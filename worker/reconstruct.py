"""Photos -> head mesh + front portrait render + the camera that rendered it.

MetaHuman's conform (conform_to_target_meshes) needs a 3D head mesh plus 2D face
landmarks from an image whose camera is known relative to that mesh. Real photos
don't come with a known camera, so this stage fits a head to the photos and then
renders a front portrait of the fitted head with a known camera. The UE script
tracks landmarks on that render, the same approach as Epic's
example_conform_from_custom_mesh.py.

This is the one piece Phase 1 still has to choose. It runs as an external
command so any implementation can plug in:

  SLOP_RECONSTRUCT_CMD="python C:/tools/my_recon.py"
      Called as: <cmd> --photos <photos.json> --out <dir>
      Must write <dir>/reconstruction.json (format below).

  SLOP_RECONSTRUCT_FIXTURE=C:/path/to/fixture_dir
      Skips reconstruction and reuses a prepared reconstruction.json. Use this
      to test the Unreal half of the pipeline with a known head scan.

Candidates (check licenses before shipping; most FLAME-based research models are
non-commercial): KeenTools FaceBuilder driven from Blender's Python API,
photogrammetry (RealityScan) for 20+ photo uploads, or a licensed commercial
face-reconstruction model.

reconstruction.json:
{
  "head_mesh": "head.obj",              # OBJ/FBX/glTF, centimeters, Z up, face toward -Y (UE conventions)
  "portrait": "portrait.png",           # front render of head_mesh, eyes open, neutral
  "camera": {                           # camera that rendered the portrait, in the mesh's space
    "location": [0.0, 100.0, 165.0],
    "rotation": {"pitch": 0.0, "yaw": -90.0, "roll": 0.0},
    "fov": 40.0
  }
}
"""
from __future__ import annotations

import json
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from backends.base import BuildError, Photo


@dataclass
class Reconstruction:
    head_mesh: Path
    portrait: Path
    camera: dict


def reconstruct(photos: list[Photo], out_dir: Path) -> Reconstruction:
    out_dir.mkdir(parents=True, exist_ok=True)

    fixture = os.environ.get("SLOP_RECONSTRUCT_FIXTURE")
    if fixture:
        return _load(Path(fixture))

    cmd = os.environ.get("SLOP_RECONSTRUCT_CMD")
    if not cmd:
        raise BuildError(
            "No reconstruction step is configured on this worker. "
            "Set SLOP_RECONSTRUCT_CMD or SLOP_RECONSTRUCT_FIXTURE (see worker/reconstruct.py).",
            retryable=False,
        )

    photos_json = out_dir / "photos.json"
    photos_json.write_text(
        json.dumps([{"slot": p.slot, "path": str(p.path), "width": p.width, "height": p.height} for p in photos]),
        encoding="utf-8",
    )
    # The command comes from the worker operator's environment, so run it through the shell as written.
    proc = subprocess.run(
        f'{cmd} --photos "{photos_json}" --out "{out_dir}"',
        shell=True,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise BuildError(f"Reconstruction failed: {(proc.stderr or proc.stdout)[-1500:]}", retryable=False)
    return _load(out_dir)


def _load(directory: Path) -> Reconstruction:
    spec_path = directory / "reconstruction.json"
    if not spec_path.exists():
        raise BuildError(f"{spec_path} not found", retryable=False)
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    head_mesh = (directory / spec["head_mesh"]).resolve()
    portrait = (directory / spec["portrait"]).resolve()
    for path in (head_mesh, portrait):
        if not path.exists():
            raise BuildError(f"Reconstruction output missing: {path}", retryable=False)
    return Reconstruction(head_mesh=head_mesh, portrait=portrait, camera=spec["camera"])
