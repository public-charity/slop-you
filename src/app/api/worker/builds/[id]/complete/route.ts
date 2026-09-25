import { completeBuild, failBuild, getBuild, type VersionFiles } from "@/lib/db";
import { checkWorker, fail, notFound, readJson } from "@/lib/http";
import { exists, keys } from "@/lib/storage";
import { RESULT_FILES } from "@/lib/worker-protocol";

type CompleteBody = {
  workerId?: unknown;
  likeness?: unknown;
  engineVersion?: unknown;
  backend?: unknown;
  rigChecks?: unknown;
  files?: unknown;
};

/**
 * Finishes a build and records a new version. The version only becomes current
 * if its likeness beats the current one (see shouldPromote in lib/db.ts).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/worker/builds/[id]/complete">) {
  const denied = checkWorker(request);
  if (denied) return denied;

  const { id } = await ctx.params;
  const build = getBuild(id);
  if (!build) return notFound();

  const body = await readJson<CompleteBody>(request);
  const workerId = typeof body?.workerId === "string" ? body.workerId : "";
  if (!body || build.status !== "running" || build.workerId !== workerId) {
    return fail(409, "Build is no longer yours");
  }

  const rigChecks = body.rigChecks && typeof body.rigChecks === "object" ? (body.rigChecks as Record<string, unknown>) : {};
  // Nothing ships unless the worker's rig checks passed: "pre-rigged" has to mean it.
  if (rigChecks.passed !== true) {
    failBuild(build.id, workerId, `Rig checks failed: ${JSON.stringify(rigChecks).slice(0, 1000)}`, false);
    return fail(422, "Rig checks did not pass; build marked failed.");
  }

  const likeness = typeof body.likeness === "number" && body.likeness >= 0 && body.likeness <= 1 ? body.likeness : null;
  const names = Array.isArray(body.files) ? body.files.filter((n): n is string => typeof n === "string") : [];

  const files: VersionFiles = {};
  for (const name of names) {
    const field = RESULT_FILES[name];
    if (!field) return fail(400, `Unexpected file: ${name}`);
    const key = keys.buildFile(build.avatarId, build.id, name);
    if (!(await exists(key))) return fail(400, `Upload ${name} before completing.`);
    files[field] = key;
  }
  if (!files.uePackage) return fail(400, "A UE package (ue-package.zip) is required.");

  const result = completeBuild(build.id, workerId, {
    likeness,
    engineVersion: typeof body.engineVersion === "string" ? body.engineVersion.slice(0, 40) : null,
    backend: typeof body.backend === "string" ? body.backend.slice(0, 40) : "unknown",
    rigChecks,
    files,
  });
  if (!result) return fail(409, "Build is no longer yours");
  return Response.json({ versionId: result.version.id, number: result.version.number, promoted: result.promoted });
}
