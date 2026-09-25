import { claimBuild, getAvatar, getPhoto, getVersion } from "@/lib/db";
import { checkWorker, fail, readJson } from "@/lib/http";
import { HEARTBEAT_SECONDS, RESULT_FILES, metaHumanAssetName } from "@/lib/worker-protocol";

/** A worker asks for the next build. 204 means the queue is empty. */
export async function POST(request: Request) {
  const denied = checkWorker(request);
  if (denied) return denied;

  const body = await readJson<{ workerId?: unknown }>(request);
  const workerId = typeof body?.workerId === "string" ? body.workerId.slice(0, 100) : "";
  if (!workerId) return fail(400, "workerId required");

  const build = claimBuild(workerId);
  if (!build) return new Response(null, { status: 204 });

  const avatar = getAvatar(build.avatarId)!;
  const photos = build.photoIds.map(getPhoto).filter((p) => p !== null);
  const previous = avatar.currentVersionId ? getVersion(avatar.currentVersionId) : null;

  return Response.json({
    build: { id: build.id, attempt: build.attempts, options: build.options },
    avatar: { id: avatar.id, assetName: metaHumanAssetName(avatar) },
    photos: photos.map((p) => ({
      id: p.id,
      slot: p.slot,
      width: p.width,
      height: p.height,
      url: `/api/worker/files/${p.storageKey}`,
    })),
    previous: previous ? { versionId: previous.id, number: previous.number, likeness: previous.likeness } : null,
    heartbeatSeconds: HEARTBEAT_SECONDS,
    uploadNames: Object.keys(RESULT_FILES),
  });
}
