import { createBuild, defaultBuildOptions, listPhotos, type BuildOptions } from "@/lib/db";
import { fail, notFound, readJson } from "@/lib/http";
import { ownedAvatar } from "@/lib/session";
import { avatarView } from "@/lib/view";

const QUALITIES: BuildOptions["quality"][] = ["LOW", "MEDIUM", "HIGH", "CINEMATIC"];

/** Queues a MetaHuman build from every photo the avatar currently has. */
export async function POST(request: Request, ctx: RouteContext<"/api/avatars/[id]/builds">) {
  const { id } = await ctx.params;
  const avatar = await ownedAvatar(id);
  if (!avatar) return notFound();

  const { canBuild } = avatarView(avatar);
  if (!canBuild.ok) return fail(409, canBuild.reason ?? "Can't build right now.");

  const body = (await readJson<{ quality?: unknown }>(request)) ?? {};
  const options = defaultBuildOptions();
  if (QUALITIES.includes(body.quality as BuildOptions["quality"])) {
    options.quality = body.quality as BuildOptions["quality"];
  }

  const build = createBuild(
    avatar.id,
    listPhotos(avatar.id).map((p) => p.id),
    options,
  );
  return Response.json({ id: build.id }, { status: 201 });
}
