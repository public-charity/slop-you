"""Real backend: reconstruct a head from the photos, then run Unreal Editor to
conform a MetaHuman to it, auto-rig it, assemble it and export it.

The editor side lives in worker/ue/build_metahuman.py and uses the MetaHuman
Character Python API that ships with UE 5.8 (see
Engine/Plugins/MetaHuman/MetaHumanCharacter/Content/Python/examples).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import zipfile
from pathlib import Path

from reconstruct import reconstruct

from .base import BuildContext, BuildError, BuildResult, write_manifest

WORKER_DIR = Path(__file__).resolve().parent.parent
UE_SCRIPT = WORKER_DIR / "ue" / "build_metahuman.py"
DEFAULT_PROJECT = WORKER_DIR / "unreal_project" / "SlopWorker.uproject"

# Content folders the editor script writes to (must match ue/build_metahuman.py).
CHARACTER_FOLDER = "SlopCharacters"
BUILD_FOLDER = "MetaHumans"


class UnrealBackend:
    name = "unreal"

    def __init__(self) -> None:
        ue_root = Path(os.environ.get("SLOP_UE_ROOT", r"C:\Program Files\Epic Games\UE_5.8"))
        self.editor = ue_root / "Engine" / "Binaries" / "Win64" / "UnrealEditor-Cmd.exe"
        self.project = Path(os.environ.get("SLOP_UE_PROJECT", str(DEFAULT_PROJECT))).resolve()
        self.timeout = int(os.environ.get("SLOP_UE_TIMEOUT", "5400"))
        self.extra_args = os.environ.get("SLOP_UE_ARGS", "-unattended -nosplash -nopause -RenderOffscreen")
        if not self.editor.exists():
            raise SystemExit(f"Unreal Editor not found at {self.editor}. Set SLOP_UE_ROOT.")
        if not self.project.exists():
            raise SystemExit(f"Worker project not found at {self.project}. Set SLOP_UE_PROJECT.")

    def build(self, ctx: BuildContext) -> BuildResult:
        out = ctx.work_dir
        out.mkdir(parents=True, exist_ok=True)

        # 1. Photos -> head mesh + portrait render + camera.
        recon = reconstruct(ctx.photos, out / "recon")

        # 2. Hand the job to the editor script.
        job = {
            "asset_name": ctx.asset_name,
            "options": ctx.options,
            "head_mesh": recon.head_mesh.as_posix(),
            "portrait": recon.portrait.as_posix(),
            "camera": recon.camera,
            "out_dir": (out / "ue").as_posix(),
            "character_folder": f"/Game/{CHARACTER_FOLDER}",
            "build_folder": f"/Game/{BUILD_FOLDER}",
        }
        (out / "ue").mkdir(exist_ok=True)
        job_path = out / "job.json"
        job_path.write_text(json.dumps(job, indent=2), encoding="utf-8")

        log_path = out / "log.txt"
        self._run_editor(ctx, job_path, log_path)

        result_path = out / "ue" / "result.json"
        if not result_path.exists():
            raise BuildError(f"Unreal exited without a result. Log tail:\n{_tail(log_path)}", retryable=True)
        result = json.loads(result_path.read_text(encoding="utf-8"))
        if not result.get("ok"):
            raise BuildError(f"Unreal build failed at '{result.get('step')}': {result.get('error')}", retryable=False)

        # 3. Package outputs.
        rig_checks = result.get("rig_checks", {})
        engine_version = result.get("engine_version")
        files: dict[str, Path] = {"log.txt": log_path}
        files["manifest.json"] = write_manifest(
            ctx, out / "manifest.json", self.name, engine_version, rig_checks, {"steps": result.get("steps", [])}
        )
        files["ue-package.zip"] = self._package_content(ctx, out / "ue-package.zip", files["manifest.json"])

        dcc_zip = next((out / "ue" / "dcc").glob("*.zip"), None)
        if dcc_zip:
            files["dcc.zip"] = dcc_zip
        dna_dir = out / "ue" / "dna"
        if dna_dir.exists() and any(dna_dir.rglob("*.dna")):
            files["dna.zip"] = _zip_dir(dna_dir, out / "dna.zip")

        # Until the preview render lands, show the reconstruction portrait (the fitted head).
        preview = out / f"preview{recon.portrait.suffix.lower()}"
        if preview.suffix in (".jpg", ".png"):
            shutil.copyfile(recon.portrait, preview)
            files[preview.name] = preview

        self._clean_project(ctx)
        return BuildResult(
            files=files,
            rig_checks=rig_checks,
            likeness=score_likeness(ctx, preview),
            engine_version=engine_version,
        )

    def _run_editor(self, ctx: BuildContext, job_path: Path, log_path: Path) -> None:
        # UE parses -ExecutePythonScript="path" itself, so build the command line by hand.
        command = (
            f'"{self.editor}" "{self.project}" -ExecutePythonScript="{UE_SCRIPT.as_posix()}" '
            f'{self.extra_args} -abslog="{log_path}"'
        )
        env = {**os.environ, "SLOP_JOB_JSON": str(job_path)}
        proc = subprocess.Popen(command, env=env)
        started = time.monotonic()
        while proc.poll() is None:
            if ctx.cancelled.is_set():
                proc.kill()
                raise BuildError("Build was taken away from this worker.", retryable=True)
            if time.monotonic() - started > self.timeout:
                proc.kill()
                raise BuildError(f"Unreal timed out after {self.timeout}s.", retryable=True)
            time.sleep(2)

    def _content_dir(self) -> Path:
        return self.project.parent / "Content"

    def _package_content(self, ctx: BuildContext, target: Path, manifest: Path) -> Path:
        content = self._content_dir()
        roots = [content / BUILD_FOLDER / ctx.asset_name, content / BUILD_FOLDER / "Common"]
        if not roots[0].exists():
            raise BuildError(f"Assembled MetaHuman not found at {roots[0]}", retryable=False)
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as z:
            for root in roots:
                for path in root.rglob("*"):
                    if path.is_file():
                        z.write(path, path.relative_to(content).as_posix())
            # The editable MetaHuman Character asset, so the owner can keep sculpting in MetaHuman Creator.
            for path in (content / CHARACTER_FOLDER).glob(f"{ctx.asset_name}*"):
                if path.is_file():
                    z.write(path, path.relative_to(content).as_posix())
            z.write(manifest, "slop-manifest.json")
        return target

    def _clean_project(self, ctx: BuildContext) -> None:
        content = self._content_dir()
        shutil.rmtree(content / BUILD_FOLDER / ctx.asset_name, ignore_errors=True)
        for path in (content / CHARACTER_FOLDER).glob(f"{ctx.asset_name}*"):
            path.unlink(missing_ok=True)


def score_likeness(ctx: BuildContext, preview: Path) -> float | None:
    """How closely the build matches the photos, from 0 to 1.

    TODO (Phase 3): render the assembled MetaHuman from each photo's angle and
    compare face-recognition embeddings against the photos. Check the embedding
    model's license; many popular open ones are non-commercial.

    Returning None means: the first version becomes current, and later versions
    only become current when the owner picks them.
    """
    return None


def _zip_dir(directory: Path, target: Path) -> Path:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for path in directory.rglob("*"):
            if path.is_file():
                z.write(path, path.relative_to(directory).as_posix())
    return target


def _tail(path: Path, chars: int = 2000) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")[-chars:]
    except OSError:
        return "(no log)"
