// JSON shapes sent to the browser. Keeps storage keys and owner ids server-side.

import { SLOTS, type SlotId } from "./capture";
import {
  activeBuild,
  listBuilds,
  listPhotos,
  listVersions,
  type Avatar,
  type Build,
  type BuildStatus,
  type PhotoCredit,
  type VersionFileName,
} from "./db";

export const fileUrl = (key: string) => `/api/files/${key}`;

export type PhotoView = {
  id: string;
  slot: SlotId;
  url: string;
  width: number;
  height: number;
  warnings: string[];
  credit: PhotoCredit | null;
};

export type BuildView = {
  id: string;
  status: BuildStatus;
  attempts: number;
  error: string | null;
  photoCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type VersionView = {
  id: string;
  number: number;
  likeness: number | null;
  engineVersion: string | null;
  backend: string;
  isCurrent: boolean;
  rigChecks: Record<string, unknown>;
  files: Partial<Record<VersionFileName, string>>;
  createdAt: string;
};

export type AvatarView = {
  id: string;
  name: string;
  /** Public-domain showcase avatar. */
  demo: boolean;
  /** True when the viewer isn't the owner (demo avatars): no uploads, builds or deletes. */
  readOnly: boolean;
  createdAt: string;
  photos: PhotoView[];
  builds: BuildView[];
  versions: VersionView[];
  activeBuild: BuildView | null;
  canBuild: { ok: boolean; reason?: string };
};

function buildView(b: Build): BuildView {
  return {
    id: b.id,
    status: b.status,
    attempts: b.attempts,
    error: b.error,
    photoCount: b.photoIds.length,
    createdAt: b.createdAt,
    startedAt: b.startedAt,
    finishedAt: b.finishedAt,
  };
}

export function avatarView(avatar: Avatar, isOwner = true): AvatarView {
  const photos = listPhotos(avatar.id);
  const active = activeBuild(avatar.id);
  const missing = SLOTS.filter((s) => s.required && !photos.some((p) => p.slot === s.id));

  let canBuild: AvatarView["canBuild"] = { ok: true };
  if (!isOwner) canBuild = { ok: false, reason: "Only the owner can build this avatar." };
  else if (active) canBuild = { ok: false, reason: "A build is already in progress." };
  else if (missing.length) canBuild = { ok: false, reason: `Add these photos first: ${missing.map((s) => s.label).join(", ")}.` };

  return {
    id: avatar.id,
    name: avatar.name,
    demo: avatar.demo,
    readOnly: !isOwner,
    createdAt: avatar.createdAt,
    photos: photos.map((p) => ({
      id: p.id,
      slot: p.slot,
      url: fileUrl(p.storageKey),
      width: p.width,
      height: p.height,
      warnings: p.checks.warnings ?? [],
      credit: p.credit,
    })),
    builds: listBuilds(avatar.id).map(buildView),
    versions: listVersions(avatar.id).map((v) => ({
      id: v.id,
      number: v.number,
      likeness: v.likeness,
      engineVersion: v.engineVersion,
      backend: v.backend,
      isCurrent: v.id === avatar.currentVersionId,
      rigChecks: v.rigChecks,
      files: Object.fromEntries(Object.entries(v.files).map(([name, key]) => [name, fileUrl(key as string)])),
      createdAt: v.createdAt,
    })),
    activeBuild: active ? buildView(active) : null,
    canBuild,
  };
}
