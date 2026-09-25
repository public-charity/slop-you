# slop.you build worker

Pulls queued builds from the site, turns photos into a rigged MetaHuman with Unreal Engine 5.8, and uploads the results. It only makes outbound HTTPS calls, so it can run on any Windows GPU machine behind NAT. Standard library Python only.

## Backends

| Backend | What it does |
|---|---|
| `mock` | Fake outputs and a likeness score that rises with photo count. For developing the site. |
| `unreal` | Reconstruct a head from the photos, then run Unreal Editor headless with `ue/build_metahuman.py`. |

## Setting up a UE machine

1. Install Unreal Engine 5.8 and a GPU driver. The MetaHuman plugins ship with the engine.
2. Open `worker/unreal_project/SlopWorker.uproject` in the editor once. Let it finish compiling shaders, and sign in to an Epic account with MetaHuman Cloud access. The auto-rig and texture steps fail without it.
3. Configure the reconstruction step (see below).
4. Run the worker with Unreal's bundled Python, so nothing else needs installing:

```bash
set SLOP_SITE=https://slop.you
set SLOP_WORKER_TOKEN=<same value as the site>
set SLOP_WORK_DIR=C:\slopw
"C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\ThirdParty\Python3\Win64\python.exe" worker\slop_worker.py --backend unreal
```

Keep `SLOP_WORK_DIR` and the checkout path short. MetaHuman exports nest deeply and hit Windows' 260-character path limit.

## Environment

| Variable | Default | |
|---|---|---|
| `SLOP_SITE` | `http://localhost:3000` | Site base URL |
| `SLOP_WORKER_TOKEN` | required | Shared secret, same as the site |
| `SLOP_WORK_DIR` | `worker/work` | Per-build scratch folders |
| `SLOP_UE_ROOT` | `C:\Program Files\Epic Games\UE_5.8` | Engine install |
| `SLOP_UE_PROJECT` | `worker/unreal_project/SlopWorker.uproject` | Build project |
| `SLOP_UE_ARGS` | `-unattended -nosplash -nopause -RenderOffscreen` | Extra editor flags |
| `SLOP_UE_TIMEOUT` | `5400` | Seconds before a build is killed |
| `SLOP_RECONSTRUCT_CMD` | none | Photos → head mesh command (see below) |
| `SLOP_RECONSTRUCT_FIXTURE` | none | Skip reconstruction and use a prepared head |
| `SLOP_MOCK_SECONDS` | `4` | Fake build time for the mock backend |

## The reconstruction step (open decision)

MetaHuman's conform needs a 3D head mesh plus a portrait render with a known camera. Photos don't have a known camera, so `reconstruct.py` runs an external command that fits a head to the photos and renders that portrait. The contract and some candidates are documented at the top of [`reconstruct.py`](reconstruct.py).

To test the Unreal half before that's decided, prepare one head scan by hand (mesh, front portrait render, camera JSON) and point `SLOP_RECONSTRUCT_FIXTURE` at its folder.

## What the Unreal script does

`ue/build_metahuman.py` runs inside the editor and follows Epic's examples in `Engine/Plugins/MetaHuman/MetaHumanCharacter/Content/Python/examples`:

import head mesh → track landmarks on the portrait → create a MetaHuman Character → conform (head only) → texture sources (cloud) → auto-rig (cloud) → assemble (`OPTIMIZED`/`CINE`, chosen quality) → export DCC and DNA → rig checks → `result.json` → quit.

A build ships only if its rig checks pass: assembled skeletal meshes exist, head and body DNA were exported, and morph targets exist when the rig type includes blendshapes.
