"""Fake backend for developing the site without Unreal.

Produces placeholder files and a made-up likeness score that rises with the
number of photos, so the "only promote if better" flow can be exercised.
"""
from __future__ import annotations

import os
import random
import shutil
import zipfile

from .base import BuildContext, BuildError, BuildResult, write_manifest


class MockBackend:
    name = "mock"

    def build(self, ctx: BuildContext) -> BuildResult:
        front = ctx.photos_in("front")
        if not front:
            raise BuildError("No front photo.")

        # Pretend to work, but stop promptly if the site takes the build away.
        delay = float(os.environ.get("SLOP_MOCK_SECONDS", "4"))
        if ctx.cancelled.wait(delay):
            raise BuildError("Cancelled", retryable=True)

        out = ctx.work_dir
        out.mkdir(parents=True, exist_ok=True)

        preview = out / "preview.jpg"
        shutil.copyfile(front[0].path, preview)

        likeness = round(min(0.97, 0.52 + 0.05 * len(ctx.photos) + random.uniform(-0.04, 0.04)), 3)
        rig_checks = {"passed": True, "mock": True, "note": "Mock build: no real rig was produced."}
        manifest = write_manifest(ctx, out / "manifest.json", self.name, "5.8", rig_checks, {"mockLikeness": likeness})

        package = out / "ue-package.zip"
        with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(manifest, "slop-manifest.json")
            z.writestr(
                f"MetaHumans/{ctx.asset_name}/README_MOCK.txt",
                "This package came from the mock worker backend. Run the worker with --backend unreal for a real MetaHuman.\n",
            )

        return BuildResult(
            files={"preview.jpg": preview, "manifest.json": manifest, "ue-package.zip": package},
            rig_checks=rig_checks,
            likeness=likeness,
            engine_version="5.8",
        )
