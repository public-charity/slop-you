import { checkWorker, notFound } from "@/lib/http";
import { contentTypeFor, isValidKey, openRead } from "@/lib/storage";

/** Lets workers download the source photos for a build. */
export async function GET(request: Request, ctx: RouteContext<"/api/worker/files/[...key]">) {
  const denied = checkWorker(request);
  if (denied) return denied;

  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  if (!isValidKey(key) || !key.includes("/photos/")) return notFound();

  const file = await openRead(key);
  if (!file) return notFound();
  return new Response(file.stream, {
    headers: { "Content-Type": contentTypeFor(key), "Content-Length": String(file.size) },
  });
}
