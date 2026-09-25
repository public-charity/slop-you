import { deleteAvatar } from "@/lib/db";
import { notFound } from "@/lib/http";
import { ownedAvatar } from "@/lib/session";
import { keys, removePrefix } from "@/lib/storage";
import { avatarView } from "@/lib/view";

export async function GET(_request: Request, ctx: RouteContext<"/api/avatars/[id]">) {
  const { id } = await ctx.params;
  const avatar = await ownedAvatar(id);
  if (!avatar) return notFound();
  return Response.json(avatarView(avatar));
}

/** Deletes the avatar, every photo, and every build output. */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/avatars/[id]">) {
  const { id } = await ctx.params;
  const avatar = await ownedAvatar(id);
  if (!avatar) return notFound();
  await removePrefix(keys.avatarPrefix(avatar.id));
  deleteAvatar(avatar.id);
  return new Response(null, { status: 204 });
}
