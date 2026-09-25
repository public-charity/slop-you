import { getVersion, setCurrentVersion } from "@/lib/db";
import { notFound } from "@/lib/http";
import { ownedAvatar } from "@/lib/session";

/** Lets the owner overrule the likeness score and pick which version is current. */
export async function POST(_request: Request, ctx: RouteContext<"/api/avatars/[id]/versions/[versionId]/promote">) {
  const { id, versionId } = await ctx.params;
  const avatar = await ownedAvatar(id);
  const version = getVersion(versionId);
  if (!avatar || !version || version.avatarId !== avatar.id) return notFound();
  setCurrentVersion(avatar.id, version.id);
  return new Response(null, { status: 204 });
}
