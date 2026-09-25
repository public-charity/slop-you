import { deletePhoto, getPhoto } from "@/lib/db";
import { notFound } from "@/lib/http";
import { ownedAvatar } from "@/lib/session";
import { removeKey } from "@/lib/storage";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/avatars/[id]/photos/[photoId]">) {
  const { id, photoId } = await ctx.params;
  const avatar = await ownedAvatar(id);
  const photo = getPhoto(photoId);
  if (!avatar || !photo || photo.avatarId !== avatar.id) return notFound();
  await removeKey(photo.storageKey);
  deletePhoto(photo.id);
  return new Response(null, { status: 204 });
}
