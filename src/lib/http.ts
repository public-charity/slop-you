import { createHash, timingSafeEqual } from "node:crypto";
import { config } from "./config";

export function fail(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export const notFound = () => fail(404, "Not found");

/** Returns an error Response if the request isn't from a build worker, otherwise null. */
export function checkWorker(request: Request): Response | null {
  if (!config.workerToken) return fail(503, "SLOP_WORKER_TOKEN is not configured on the server.");
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = createHash("sha256").update(token).digest();
  const b = createHash("sha256").update(config.workerToken).digest();
  return timingSafeEqual(a, b) ? null : fail(401, "Bad worker token");
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
