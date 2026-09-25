import { config } from "@/lib/config";
import { getBuild } from "@/lib/db";
import { checkWorker, fail, notFound } from "@/lib/http";
import { keys, putStream } from "@/lib/storage";
import { RESULT_FILES } from "@/lib/worker-protocol";

/** Raw-body upload of one result file, streamed to storage. */
export async function PUT(request: Request, ctx: RouteContext<"/api/worker/builds/[id]/files/[name]">) {
  const denied = checkWorker(request);
  if (denied) return denied;

  const { id, name } = await ctx.params;
  if (!(name in RESULT_FILES)) return fail(400, `Unexpected file name. Allowed: ${Object.keys(RESULT_FILES).join(", ")}`);

  const build = getBuild(id);
  if (!build) return notFound();
  if (build.status !== "running" || build.workerId !== request.headers.get("x-worker-id")) {
    return fail(409, "Build is no longer yours");
  }
  if (!request.body) return fail(400, "Empty body");

  try {
    const bytes = await putStream(keys.buildFile(build.avatarId, build.id, name), request.body, config.maxResultBytes);
    return Response.json({ name, bytes }, { status: 201 });
  } catch (err) {
    return fail(413, err instanceof Error ? err.message : "Upload failed");
  }
}
