import { CONSENT_VERSION, isCompleteConsent } from "@/lib/consent";
import { createAvatar } from "@/lib/db";
import { fail, readJson } from "@/lib/http";
import { ensureSessionId } from "@/lib/session";

export async function POST(request: Request) {
  const body = await readJson<{ name?: unknown; consentVersion?: unknown; consent?: unknown }>(request);
  if (!body) return fail(400, "Expected JSON");

  if (body.consentVersion !== CONSENT_VERSION || !isCompleteConsent(body.consent)) {
    return fail(400, "Every consent box must be checked.");
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";
  if (!name) return fail(400, "Give your avatar a name.");

  const ownerSid = await ensureSessionId();
  const avatar = createAvatar({ ownerSid, name, consentVersion: CONSENT_VERSION });
  return Response.json({ id: avatar.id }, { status: 201 });
}
