import path from "node:path";

export const config = {
  /** Where the SQLite database and uploaded/generated files live in dev. */
  dataDir: process.env.SLOP_DATA_DIR ?? path.join(process.cwd(), ".data"),
  /** Shared secret the UE build workers send as `Authorization: Bearer <token>`. */
  workerToken: process.env.SLOP_WORKER_TOKEN ?? "",
  maxPhotoBytes: 20 * 1024 * 1024,
  /** Shorter side of an uploaded photo, in pixels. MetaHuman face tracking needs real detail. */
  minPhotoShortSide: 720,
  maxPhotosPerAvatar: 40,
  /** Per-file cap for worker uploads. Cinematic MetaHuman packages get big. */
  maxResultBytes: 20 * 1024 ** 3,
  /** How long a worker holds a build before it is considered dead. Workers heartbeat to extend it. */
  leaseMinutes: 20,
  maxBuildAttempts: 3,
  /** The engine version the worker farm builds for. Packages open in this version or newer. */
  targetEngine: process.env.SLOP_TARGET_ENGINE ?? "5.8",
};
