# slop.you

Photos in, rigged MetaHuman out. People upload a few photos of themselves and get a MetaHuman they can drop straight into an **Unreal Engine 5.8+** project, already rigged for face and body. They can add photos later: every rebuild gets scored, and a new version only replaces the current one when it looks more like them.

## How it works

```
Browser                          Site (Next.js)                     UE build worker (Windows + GPU)
───────                          ──────────────                     ───────────────────────────────
consent → guided photos ──────►  photos (EXIF/GPS stripped)
MediaPipe checks pose,           build queue (SQLite in dev)  ◄──── claim (outbound HTTPS only)
focus, light, eyes, 1 face       leases + heartbeats                photos → head mesh (reconstruct.py)
                                                                    Unreal Editor + MetaHuman Python API:
                                                                      conform → textures → auto-rig →
                                                                      assemble → export DCC + DNA → rig checks
versions, likeness, downloads ◄─ "only promote if better"   ◄────  upload UE package, DCC zip, DNA, manifest
```

Every model is rigged the same way because it's the same rig: the worker conforms Epic's MetaHuman template to each person rather than rigging meshes one by one. The site refuses any build whose rig checks didn't pass.

## Run it locally

Needs Node 22.13+ (uses the built-in `node:sqlite`).

```bash
npm install
cp .env.example .env.local   # then set SLOP_WORKER_TOKEN to a random string
npm run dev
```

Open http://localhost:3000. To process builds without Unreal, run the mock worker in a second terminal (it fakes the outputs and a likeness score):

```bash
SLOP_WORKER_TOKEN=<same token> python worker/slop_worker.py --backend mock
```

For the real pipeline on a UE machine, see [worker/README.md](worker/README.md).

### Demo gallery

`npm run seed:demo` creates read-only demo avatars from public-domain portraits on Wikimedia Commons (listed in [demo/people.json](demo/people.json)) and queues a build for each; run a worker to process them. Demo avatars are visible to everyone, can't be edited, and show photo credits. The seed script only accepts historical figures who died before 1926. Never add living or recent people: the product's rule is that everyone builds an avatar of themselves.

## Layout

| Path | What |
|---|---|
| `src/app/` | Pages (`/`, `/create`, `/avatars/[id]`) and API routes |
| `src/app/api/worker/` | The worker protocol: claim, heartbeat, upload, complete, fail |
| `src/lib/db.ts` | All SQL. Swap this file for Postgres in production |
| `src/lib/storage.ts` | File storage on disk. Swap for S3/R2 with presigned uploads in production |
| `src/lib/face-check.ts` | In-browser photo checks (MediaPipe Face Landmarker) |
| `src/lib/consent.ts` | **Draft** consent text, versioned per avatar |
| `worker/` | Python build worker (standard library only) and the in-editor UE script |

## Phase 1 status

Done:
- Consent flow, guided four-angle upload with browser checks, owner-only file access, full delete
- Build queue with leases, heartbeats, retries and a rig-check gate
- Versioning with "only promote if the likeness score improves" and manual override
- Mock worker, plus an Unreal worker wired to UE 5.8's MetaHuman Character Python API (conform, cloud textures, cloud auto-rig, assembly, DCC and DNA export)

Next:
1. **Choose the reconstruction step** (photos → head mesh + portrait + camera). See `worker/reconstruct.py`.
2. First real run on the UE machine with a test head, to confirm the head-only conform commit step.
3. Preview renders and likeness scoring (`score_likeness` in `worker/backends/unreal.py`).
4. Before launch: real accounts, Postgres, S3/R2, a selfie liveness check matched against uploads, and a lawyer's review of the consent text and retention policy.

## Licensing notes

- MetaHumans fall under the Unreal Engine EULA: free under $1M a year in revenue, seat licenses above that. Auto-rigging and texture synthesis run on Epic's MetaHuman Cloud and need a signed-in Epic account.
- The MetaHuman license **forbids using MetaHumans to train or improve AI models**, so the "better every time" loop must not train on build outputs.
- A public service that generates MetaHumans for other people is an unusual use of Epic's cloud services. Get Epic's confirmation in writing before launch.
- Face geometry is biometric data (Illinois BIPA, Texas CUBI, GDPR Art. 9).
