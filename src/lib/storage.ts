// File storage. Dev writes under .data/files; swap these functions for S3/R2
// (presigned URLs for worker uploads) before production.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { config } from "./config";

const root = path.join(config.dataDir, "files");

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export function isValidKey(key: string): boolean {
  const parts = key.split("/");
  return parts.length > 0 && parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..");
}

function resolveKey(key: string): string {
  if (!isValidKey(key)) throw new Error(`Invalid storage key: ${key}`);
  const full = path.join(root, ...key.split("/"));
  if (!full.startsWith(root + path.sep)) throw new Error(`Storage key escapes root: ${key}`);
  return full;
}

export const keys = {
  photo: (avatarId: string, photoId: string) => `avatars/${avatarId}/photos/${photoId}.jpg`,
  buildFile: (avatarId: string, buildId: string, fileName: string) => `avatars/${avatarId}/builds/${buildId}/${fileName}`,
  avatarPrefix: (avatarId: string) => `avatars/${avatarId}`,
};

/** The avatar a key belongs to, used for access checks. */
export function avatarIdFromKey(key: string): string | null {
  const match = /^avatars\/([^/]+)\//.exec(key);
  return match ? match[1] : null;
}

export async function putBuffer(key: string, data: Uint8Array): Promise<void> {
  const full = resolveKey(key);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, data);
}

/** Streams a request body to disk without buffering it (UE packages can be several GB). */
export async function putStream(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number> {
  const full = resolveKey(key);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.${Date.now()}.part`;
  let written = 0;
  const source = Readable.fromWeb(body as unknown as NodeWebReadableStream<Uint8Array>);
  source.on("data", (chunk: Buffer) => {
    written += chunk.length;
    if (written > maxBytes) source.destroy(new Error(`Upload exceeds ${maxBytes} bytes`));
  });
  try {
    await pipeline(source, fs.createWriteStream(tmp));
    await fsp.rename(tmp, full);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  return written;
}

export async function openRead(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  const full = resolveKey(key);
  const stat = await fsp.stat(full).catch(() => null);
  if (!stat?.isFile()) return null;
  const stream = Readable.toWeb(fs.createReadStream(full)) as unknown as ReadableStream<Uint8Array>;
  return { stream, size: stat.size };
}

export async function exists(key: string): Promise<boolean> {
  const stat = await fsp.stat(resolveKey(key)).catch(() => null);
  return Boolean(stat?.isFile());
}

export async function removeKey(key: string): Promise<void> {
  await fsp.rm(resolveKey(key), { force: true });
}

export async function removePrefix(prefix: string): Promise<void> {
  await fsp.rm(resolveKey(prefix), { recursive: true, force: true });
}

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".zip": "application/zip",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

export function contentTypeFor(key: string): string {
  return CONTENT_TYPES[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}
