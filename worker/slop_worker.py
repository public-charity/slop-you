"""slop.you build worker.

Pulls queued builds from the site, runs a backend, uploads the results. Workers
only make outbound HTTPS calls, so a UE machine can sit behind any NAT.

    set SLOP_SITE=http://localhost:3000
    set SLOP_WORKER_TOKEN=<same value as the site>
    python worker/slop_worker.py --backend mock
    python worker/slop_worker.py --backend unreal --once

Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from backends import BuildContext, BuildError, Photo, get_backend  # noqa: E402


class Api:
    def __init__(self, site: str, token: str, worker_id: str):
        self.site = site.rstrip("/")
        self.token = token
        self.worker_id = worker_id

    def _request(self, method: str, path: str, *, json_body=None, data=None, headers=None, timeout=120):
        all_headers = {"Authorization": f"Bearer {self.token}", "X-Worker-Id": self.worker_id, **(headers or {})}
        if json_body is not None:
            data = json.dumps(json_body).encode()
            all_headers["Content-Type"] = "application/json"
        req = urllib.request.Request(self.site + path, data=data, method=method, headers=all_headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.status, res.read()
        except urllib.error.HTTPError as err:
            return err.code, err.read()

    def claim(self) -> dict | None:
        status, body = self._request("POST", "/api/worker/claim", json_body={"workerId": self.worker_id})
        if status == 204:
            return None
        if status != 200:
            raise RuntimeError(f"claim failed: HTTP {status} {body[:300]!r}")
        return json.loads(body)

    def download(self, path: str, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(self.site + path, headers={"Authorization": f"Bearer {self.token}"})
        with urllib.request.urlopen(req, timeout=300) as res, open(dest, "wb") as f:
            shutil.copyfileobj(res, f)

    def heartbeat(self, build_id: str) -> bool:
        status, _ = self._request("POST", f"/api/worker/builds/{build_id}/heartbeat", json_body={"workerId": self.worker_id}, timeout=30)
        return status != 409

    def upload(self, build_id: str, name: str, path: Path) -> None:
        with open(path, "rb") as f:
            status, body = self._request(
                "PUT",
                f"/api/worker/builds/{build_id}/files/{name}",
                data=f,
                headers={"Content-Type": "application/octet-stream", "Content-Length": str(path.stat().st_size)},
                timeout=3600,
            )
        if status != 201:
            raise RuntimeError(f"upload {name} failed: HTTP {status} {body[:300]!r}")

    def complete(self, build_id: str, payload: dict) -> dict:
        status, body = self._request("POST", f"/api/worker/builds/{build_id}/complete", json_body={"workerId": self.worker_id, **payload})
        if status != 200:
            raise RuntimeError(f"complete failed: HTTP {status} {body[:300]!r}")
        return json.loads(body)

    def fail(self, build_id: str, error: str, retryable: bool) -> None:
        self._request("POST", f"/api/worker/builds/{build_id}/fail", json_body={"workerId": self.worker_id, "error": error, "retryable": retryable})


class Heartbeat(threading.Thread):
    """Keeps the lease alive during long Unreal runs; sets `lost` if the site takes the build back."""

    def __init__(self, api: Api, build_id: str, every: float):
        super().__init__(daemon=True)
        self.api, self.build_id, self.every = api, build_id, every
        self.lost = threading.Event()
        self._halt = threading.Event()

    def run(self) -> None:
        while not self._halt.wait(self.every):
            try:
                if not self.api.heartbeat(self.build_id):
                    self.lost.set()
                    return
            except OSError as err:  # network blip: keep trying until the lease runs out
                log(f"heartbeat error: {err}")

    def stop(self) -> None:
        self._halt.set()


def log(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def run_one(api: Api, backend, work_root: Path, keep: bool) -> bool:
    job = api.claim()
    if not job:
        return False

    build_id = job["build"]["id"]
    log(f"claimed {build_id} for {job['avatar']['assetName']} ({len(job['photos'])} photos, attempt {job['build']['attempt']})")
    work = work_root / build_id
    shutil.rmtree(work, ignore_errors=True)
    heartbeat = Heartbeat(api, build_id, job.get("heartbeatSeconds", 60))
    heartbeat.start()
    try:
        photos = []
        for p in job["photos"]:
            dest = work / "photos" / f"{p['slot']}_{p['id']}.jpg"
            api.download(p["url"], dest)
            photos.append(Photo(slot=p["slot"], path=dest, width=p["width"], height=p["height"]))

        previous = job.get("previous") or {}
        ctx = BuildContext(
            build_id=build_id,
            avatar_id=job["avatar"]["id"],
            asset_name=job["avatar"]["assetName"],
            options=job["build"]["options"],
            photos=photos,
            previous_likeness=previous.get("likeness"),
            work_dir=work / "out",
            cancelled=heartbeat.lost,
        )
        result = backend.build(ctx)
        if heartbeat.lost.is_set():
            log(f"{build_id} was reassigned; dropping result")
            return True
        if result.rig_checks.get("passed") is not True:
            raise BuildError(f"Rig checks failed: {json.dumps(result.rig_checks)[:1000]}")

        for name, path in result.files.items():
            log(f"uploading {name} ({path.stat().st_size:,} bytes)")
            api.upload(build_id, name, path)
        done = api.complete(
            build_id,
            {
                "likeness": result.likeness,
                "engineVersion": result.engine_version,
                "backend": backend.name,
                "rigChecks": result.rig_checks,
                "files": list(result.files),
            },
        )
        log(f"{build_id} -> version {done['number']} ({'now current' if done['promoted'] else 'kept previous version current'})")
    except BuildError as err:
        log(f"{build_id} failed: {err}")
        api.fail(build_id, str(err), err.retryable)
    except Exception as err:  # unexpected: retry on another attempt
        traceback.print_exc()
        api.fail(build_id, f"{type(err).__name__}: {err}", True)
    finally:
        heartbeat.stop()
        if not keep:
            shutil.rmtree(work, ignore_errors=True)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="slop.you build worker")
    parser.add_argument("--backend", choices=["mock", "unreal"], default="mock")
    parser.add_argument("--site", default=os.environ.get("SLOP_SITE", "http://localhost:3000"))
    parser.add_argument("--once", action="store_true", help="process at most one build, then exit")
    parser.add_argument("--poll", type=float, default=5.0, help="seconds between polls when the queue is empty")
    parser.add_argument("--keep", action="store_true", help="keep each build's work folder for debugging")
    # Keep this path short on Windows: MetaHuman exports nest deeply and hit the 260-char limit.
    parser.add_argument("--work", default=os.environ.get("SLOP_WORK_DIR", str(Path(__file__).resolve().parent / "work")))
    args = parser.parse_args()

    token = os.environ.get("SLOP_WORKER_TOKEN")
    if not token:
        raise SystemExit("Set SLOP_WORKER_TOKEN (the same value the site uses).")

    api = Api(args.site, token, f"{socket.gethostname()}-{os.getpid()}")
    backend = get_backend(args.backend)
    work_root = Path(args.work)
    log(f"worker {api.worker_id} using {args.backend} backend against {api.site}")

    while True:
        try:
            worked = run_one(api, backend, work_root, args.keep)
        except OSError as err:  # site unreachable
            log(f"site unreachable: {err}")
            worked = False
        if args.once:
            return
        if not worked:
            time.sleep(args.poll)


if __name__ == "__main__":
    main()
