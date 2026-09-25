import { isSlotId } from "@/lib/capture";
import { config } from "@/lib/config";
import { addPhoto, listPhotos, newId, type PhotoChecks } from "@/lib/db";
import { fail, notFound } from "@/lib/http";
import { normalizePhoto } from "@/lib/images";
import { ownedAvatar } from "@/lib/session";
import { keys, putBuffer } from "@/lib/storage";

const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request, ctx: RouteContext<"/api/avatars/[id]/photos">) {
  const { id } = await ctx.params;
  const avatar = await ownedAvatar(id);
  if (!avatar) return notFound();

  if (listPhotos(avatar.id).length >= config.maxPhotosPerAvatar) {
    return fail(409, `An avatar can have at most ${config.maxPhotosPerAvatar} photos. Delete some first.`);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const slot = form?.get("slot");
  if (!(file instanceof File)) return fail(400, "Missing file");
  if (!isSlotId(slot)) return fail(400, "Unknown photo slot");
  if (!ACCEPTED.has(file.type)) return fail(415, "Upload a JPEG, PNG or WebP image.");
  if (file.size > config.maxPhotoBytes) return fail(413, "That photo is too large.");

  const output = await normalizePhoto(Buffer.from(await file.arrayBuffer())).catch(() => null);
  if (!output) return fail(415, "That file couldn't be read as an image.");

  const { width, height } = output.info;
  if (Math.min(width, height) < config.minPhotoShortSide) {
    return fail(422, `Photo is ${width}×${height}. The shorter side needs at least ${config.minPhotoShortSide}px.`);
  }

  const photoId = newId("ph");
  const storageKey = keys.photo(avatar.id, photoId);
  await putBuffer(storageKey, output.data);

  const photo = addPhoto({
    id: photoId,
    avatarId: avatar.id,
    slot,
    storageKey,
    width,
    height,
    checks: sanitizeChecks(form?.get("checks")),
    credit: null,
  });
  return Response.json({ id: photo.id }, { status: 201 });
}

/** Browser-side check results are advisory; keep only known, bounded fields. */
function sanitizeChecks(raw: FormDataEntryValue | null | undefined): PhotoChecks {
  if (typeof raw !== "string") return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    return {
      yaw: num(value.yaw) ?? null,
      sharpness: num(value.sharpness),
      brightness: num(value.brightness),
      warnings: Array.isArray(value.warnings)
        ? value.warnings.filter((w): w is string => typeof w === "string").slice(0, 10).map((w) => w.slice(0, 200))
        : [],
    };
  } catch {
    return {};
  }
}
