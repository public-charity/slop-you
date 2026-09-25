import { failBuild } from "@/lib/db";
import { checkWorker, fail, readJson } from "@/lib/http";

/** Reports a failed build. Retryable failures go back in the queue until attempts run out. */
export async function POST(request: Request, ctx: RouteContext<"/api/worker/builds/[id]/fail">) {
  const denied = checkWorker(request);
  if (denied) return denied;

  const { id } = await ctx.params;
  const body = await readJson<{ workerId?: unknown; error?: unknown; retryable?: unknown }>(request);
  const workerId = typeof body?.workerId === "string" ? body.workerId : "";
  const error = typeof body?.error === "string" && body.error ? body.error : "Unknown worker error";
  const ok = failBuild(id, workerId, error, body?.retryable === true);
  return ok ? new Response(null, { status: 204 }) : fail(409, "Build is no longer yours");
}
