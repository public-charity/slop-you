// The contract between the site and UE build workers (see worker/slop_worker.py).

import type { Avatar, VersionFileName } from "./db";

/** Files a worker may upload for a build, and which version field each one fills. */
export const RESULT_FILES: Record<string, VersionFileName> = {
  "preview.jpg": "preview",
  "preview.png": "preview",
  "ue-package.zip": "uePackage",
  "dcc.zip": "dcc",
  "dna.zip": "dna",
  "manifest.json": "manifest",
  "log.txt": "log",
};

export const HEARTBEAT_SECONDS = 60;

/** A UE-safe asset name that stays unique across avatars on the same worker. */
export function metaHumanAssetName(avatar: Avatar): string {
  const clean = avatar.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "Avatar";
  return `MH_${clean}_${avatar.id.slice(3, 11)}`;
}
