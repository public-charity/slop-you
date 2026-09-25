import { notFound } from "@/lib/http";
import { ownedAvatar } from "@/lib/session";
import { avatarIdFromKey, contentTypeFor, isValidKey, openRead } from "@/lib/storage";

/** Serves photos, previews and downloads to the avatar's owner only. */
export async function GET(_request: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  const avatarId = isValidKey(key) ? avatarIdFromKey(key) : null;
  if (!avatarId || !(await ownedAvatar(avatarId))) return notFound();

  const file = await openRead(key);
  if (!file) return notFound();

  const type = contentTypeFor(key);
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Length": String(file.size),
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  if (!type.startsWith("image/")) {
    headers["Content-Disposition"] = `attachment; filename="${parts[parts.length - 1]}"`;
  }
  return new Response(file.stream, { headers });
}
