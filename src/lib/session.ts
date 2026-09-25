// Phase 1 uses an anonymous, httpOnly session cookie to own avatars.
// Replace with real accounts (Auth.js, Clerk, etc.) before taking payments.

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { getAvatar, type Avatar } from "./db";

const COOKIE = "slop_sid";
const SID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function readSessionId(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE)?.value;
  return value && SID.test(value) ? value : null;
}

/** Only callable from Route Handlers and Server Functions (it may set a cookie). */
export async function ensureSessionId(): Promise<string> {
  const existing = await readSessionId();
  if (existing) return existing;
  const sid = randomUUID();
  (await cookies()).set(COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return sid;
}

/** The avatar if the current visitor owns it. Callers should 404 otherwise so ids don't leak. */
export async function ownedAvatar(avatarId: string): Promise<Avatar | null> {
  const sid = await readSessionId();
  if (!sid) return null;
  const avatar = getAvatar(avatarId);
  return avatar && avatar.ownerSid === sid ? avatar : null;
}
