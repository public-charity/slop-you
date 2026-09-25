import { heartbeatBuild } from "@/lib/db";
import { checkWorker, fail, readJson } from "@/lib/http";

/** Extends the worker's lease. 409 tells the worker to abandon the build (deleted or reassigned). */
export async function POST(request: Request, ctx: RouteContext<"/api/worker/builds/[id]/heartbeat">) {
  const denied = checkWorker(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await readJson<{ workerId?: unknown }>(request);
  const workerId = typeof body?.workerId === "string" ? body.workerId : "";
  return heartbeatBuild(id, workerId) ? new Response(null, { status: 204 }) : fail(409, "Build is no longer yours");
}
