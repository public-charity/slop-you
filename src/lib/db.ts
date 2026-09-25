// Data layer. Dev uses Node's built-in SQLite (no native deps); every query lives
// in this file so moving to Postgres for production only touches this module.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import type { SlotId } from "./capture";

// ---------------------------------------------------------------------------
// Types

export type Avatar = {
  id: string;
  ownerSid: string;
  name: string;
  consentVersion: string;
  consentAt: string;
  currentVersionId: string | null;
  /** Read-only showcase avatar built from public-domain photos (see scripts/seed-demo.ts). */
  demo: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Attribution for photos that didn't come from the avatar's owner (demo avatars). */
export type PhotoCredit = {
  title: string;
  author: string;
  date: string;
  license: string;
  url: string;
};

export type PhotoChecks = {
  yaw?: number | null;
  sharpness?: number;
  brightness?: number;
  warnings?: string[];
};

export type Photo = {
  id: string;
  avatarId: string;
  slot: SlotId;
  storageKey: string;
  width: number;
  height: number;
  checks: PhotoChecks;
  credit: PhotoCredit | null;
  createdAt: string;
};

export type BuildStatus = "queued" | "running" | "succeeded" | "failed";

/** Mirrors the MetaHuman Python enums the UE worker passes through. */
export type BuildOptions = {
  pipeline: "OPTIMIZED" | "CINE";
  quality: "LOW" | "MEDIUM" | "HIGH" | "CINEMATIC";
  rigType: "JOINTS_ONLY" | "JOINTS_AND_BLENDSHAPES";
  engine: string;
};

export type Build = {
  id: string;
  avatarId: string;
  status: BuildStatus;
  photoIds: string[];
  options: BuildOptions;
  attempts: number;
  workerId: string | null;
  leaseExpiresAt: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export const VERSION_FILE_NAMES = ["preview", "uePackage", "dcc", "dna", "manifest", "log"] as const;
export type VersionFileName = (typeof VERSION_FILE_NAMES)[number];
export type VersionFiles = Partial<Record<VersionFileName, string>>;

export type Version = {
  id: string;
  avatarId: string;
  buildId: string;
  number: number;
  likeness: number | null;
  engineVersion: string | null;
  backend: string;
  rigChecks: Record<string, unknown>;
  files: VersionFiles;
  createdAt: string;
};

// ---------------------------------------------------------------------------
// Connection + migrations

type Row = Record<string, unknown>;

const MIGRATIONS = [
  `
  CREATE TABLE avatars (
    id TEXT PRIMARY KEY,
    owner_sid TEXT NOT NULL,
    name TEXT NOT NULL,
    consent_version TEXT NOT NULL,
    consent_at TEXT NOT NULL,
    current_version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX avatars_owner ON avatars(owner_sid, created_at);

  CREATE TABLE photos (
    id TEXT PRIMARY KEY,
    avatar_id TEXT NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
    slot TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    checks_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX photos_avatar ON photos(avatar_id, created_at);

  CREATE TABLE builds (
    id TEXT PRIMARY KEY,
    avatar_id TEXT NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    photo_ids_json TEXT NOT NULL,
    options_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    worker_id TEXT,
    lease_expires_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX builds_queue ON builds(status, created_at);
  CREATE INDEX builds_avatar ON builds(avatar_id, created_at);

  CREATE TABLE versions (
    id TEXT PRIMARY KEY,
    avatar_id TEXT NOT NULL REFERENCES avatars(id) ON DELETE CASCADE,
    build_id TEXT NOT NULL UNIQUE,
    number INTEGER NOT NULL,
    likeness REAL,
    engine_version TEXT,
    backend TEXT NOT NULL,
    rig_checks_json TEXT NOT NULL DEFAULT '{}',
    files_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX versions_avatar ON versions(avatar_id, number);
  `,
  `
  ALTER TABLE avatars ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE photos ADD COLUMN credit_json TEXT;
  CREATE INDEX avatars_demo ON avatars(demo, name);
  `,
];

/** Demo avatars have no session owner; this can never match a real session id. */
export const DEMO_OWNER = "demo";

function open(): DatabaseSync {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const conn = new DatabaseSync(path.join(config.dataDir, "slop.db"));
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const { user_version: current } = conn.prepare("PRAGMA user_version").get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    conn.exec("BEGIN");
    try {
      conn.exec(MIGRATIONS[v]);
      conn.exec(`PRAGMA user_version = ${v + 1}`);
      conn.exec("COMMIT");
    } catch (err) {
      conn.exec("ROLLBACK");
      throw err;
    }
  }
  return conn;
}

// Survive dev hot reloads without opening a new handle each time.
const globalForDb = globalThis as unknown as { slopDb?: DatabaseSync };

function db(): DatabaseSync {
  return (globalForDb.slopDb ??= open());
}

/** node:sqlite is synchronous, so a transaction is atomic with respect to other requests. */
function tx<T>(fn: (conn: DatabaseSync) => T): T {
  const conn = db();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(conn);
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

const now = () => new Date().toISOString();

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Row mappers

function toAvatar(r: Row): Avatar {
  return {
    id: r.id as string,
    ownerSid: r.owner_sid as string,
    name: r.name as string,
    consentVersion: r.consent_version as string,
    consentAt: r.consent_at as string,
    currentVersionId: (r.current_version_id as string | null) ?? null,
    demo: Number(r.demo) === 1,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function toPhoto(r: Row): Photo {
  return {
    id: r.id as string,
    avatarId: r.avatar_id as string,
    slot: r.slot as SlotId,
    storageKey: r.storage_key as string,
    width: Number(r.width),
    height: Number(r.height),
    checks: parseJson<PhotoChecks>(r.checks_json, {}),
    credit: parseJson<PhotoCredit | null>(r.credit_json, null),
    createdAt: r.created_at as string,
  };
}

function toBuild(r: Row): Build {
  return {
    id: r.id as string,
    avatarId: r.avatar_id as string,
    status: r.status as BuildStatus,
    photoIds: parseJson<string[]>(r.photo_ids_json, []),
    options: parseJson<BuildOptions>(r.options_json, defaultBuildOptions()),
    attempts: Number(r.attempts),
    workerId: (r.worker_id as string | null) ?? null,
    leaseExpiresAt: (r.lease_expires_at as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at as string,
    startedAt: (r.started_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
  };
}

function toVersion(r: Row): Version {
  return {
    id: r.id as string,
    avatarId: r.avatar_id as string,
    buildId: r.build_id as string,
    number: Number(r.number),
    likeness: r.likeness === null || r.likeness === undefined ? null : Number(r.likeness),
    engineVersion: (r.engine_version as string | null) ?? null,
    backend: r.backend as string,
    rigChecks: parseJson<Record<string, unknown>>(r.rig_checks_json, {}),
    files: parseJson<VersionFiles>(r.files_json, {}),
    createdAt: r.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// Avatars

export function createAvatar(input: { ownerSid: string; name: string; consentVersion: string }): Avatar {
  const ts = now();
  const id = newId("av");
  db()
    .prepare(
      `INSERT INTO avatars (id, owner_sid, name, consent_version, consent_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.ownerSid, input.name, input.consentVersion, ts, ts, ts);
  return getAvatar(id)!;
}

export function createDemoAvatar(name: string): Avatar {
  const ts = now();
  const id = newId("av");
  db()
    .prepare(
      `INSERT INTO avatars (id, owner_sid, name, consent_version, consent_at, demo, created_at, updated_at)
       VALUES (?, ?, ?, 'demo:public-domain', ?, 1, ?, ?)`,
    )
    .run(id, DEMO_OWNER, name, ts, ts, ts);
  return getAvatar(id)!;
}

export function getAvatar(id: string): Avatar | null {
  const row = db().prepare("SELECT * FROM avatars WHERE id = ?").get(id);
  return row ? toAvatar(row) : null;
}

export type AvatarSummary = Avatar & {
  photoCount: number;
  current: Version | null;
  latestBuild: Build | null;
};

export function listAvatarsForOwner(ownerSid: string): AvatarSummary[] {
  return summarize(db().prepare("SELECT * FROM avatars WHERE owner_sid = ? ORDER BY created_at DESC").all(ownerSid));
}

export function listDemoAvatars(): AvatarSummary[] {
  return summarize(db().prepare("SELECT * FROM avatars WHERE demo = 1 ORDER BY name").all());
}

function summarize(rows: Row[]): AvatarSummary[] {
  return rows.map((row) => {
    const avatar = toAvatar(row);
    const count = db().prepare("SELECT COUNT(*) AS n FROM photos WHERE avatar_id = ?").get(avatar.id) as { n: number };
    return {
      ...avatar,
      photoCount: Number(count.n),
      current: avatar.currentVersionId ? getVersion(avatar.currentVersionId) : null,
      latestBuild: listBuilds(avatar.id, 1)[0] ?? null,
    };
  });
}

export function deleteAvatar(id: string): void {
  db().prepare("DELETE FROM avatars WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Photos

export function addPhoto(input: Omit<Photo, "createdAt">): Photo {
  db()
    .prepare(
      `INSERT INTO photos (id, avatar_id, slot, storage_key, width, height, checks_json, credit_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.avatarId,
      input.slot,
      input.storageKey,
      input.width,
      input.height,
      JSON.stringify(input.checks),
      input.credit ? JSON.stringify(input.credit) : null,
      now(),
    );
  touchAvatar(input.avatarId);
  return getPhoto(input.id)!;
}

export function getPhoto(id: string): Photo | null {
  const row = db().prepare("SELECT * FROM photos WHERE id = ?").get(id);
  return row ? toPhoto(row) : null;
}

export function listPhotos(avatarId: string): Photo[] {
  return db().prepare("SELECT * FROM photos WHERE avatar_id = ? ORDER BY created_at").all(avatarId).map(toPhoto);
}

export function deletePhoto(id: string): void {
  db().prepare("DELETE FROM photos WHERE id = ?").run(id);
}

// ---------------------------------------------------------------------------
// Builds (the job queue the UE workers pull from)

export function defaultBuildOptions(): BuildOptions {
  return {
    pipeline: "OPTIMIZED",
    quality: "HIGH",
    rigType: "JOINTS_AND_BLENDSHAPES",
    engine: config.targetEngine,
  };
}

export function createBuild(avatarId: string, photoIds: string[], options: BuildOptions): Build {
  const id = newId("bld");
  db()
    .prepare(
      `INSERT INTO builds (id, avatar_id, status, photo_ids_json, options_json, created_at)
       VALUES (?, ?, 'queued', ?, ?, ?)`,
    )
    .run(id, avatarId, JSON.stringify(photoIds), JSON.stringify(options), now());
  touchAvatar(avatarId);
  return getBuild(id)!;
}

export function getBuild(id: string): Build | null {
  const row = db().prepare("SELECT * FROM builds WHERE id = ?").get(id);
  return row ? toBuild(row) : null;
}

export function listBuilds(avatarId: string, limit = 20): Build[] {
  return db()
    .prepare("SELECT * FROM builds WHERE avatar_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(avatarId, limit)
    .map(toBuild);
}

export function activeBuild(avatarId: string): Build | null {
  const row = db()
    .prepare("SELECT * FROM builds WHERE avatar_id = ? AND status IN ('queued', 'running') LIMIT 1")
    .get(avatarId);
  return row ? toBuild(row) : null;
}

/** Hands the oldest queued build (or one whose worker went silent) to a worker. */
export function claimBuild(workerId: string): Build | null {
  return tx((conn) => {
    const ts = new Date();
    const tsIso = ts.toISOString();
    for (;;) {
      const row = conn
        .prepare(
          `SELECT * FROM builds
           WHERE status = 'queued' OR (status = 'running' AND lease_expires_at < ?)
           ORDER BY created_at LIMIT 1`,
        )
        .get(tsIso);
      if (!row) return null;
      const build = toBuild(row);
      if (build.attempts >= config.maxBuildAttempts) {
        conn
          .prepare("UPDATE builds SET status = 'failed', error = ?, lease_expires_at = NULL, finished_at = ? WHERE id = ?")
          .run(build.error ?? "Gave up after too many attempts.", tsIso, build.id);
        continue;
      }
      const lease = new Date(ts.getTime() + config.leaseMinutes * 60_000).toISOString();
      conn
        .prepare(
          `UPDATE builds SET status = 'running', worker_id = ?, attempts = attempts + 1,
             lease_expires_at = ?, started_at = ? WHERE id = ?`,
        )
        .run(workerId, lease, tsIso, build.id);
      return getBuild(build.id);
    }
  });
}

/** Returns false if the worker no longer owns the build (lease expired and it was reassigned). */
export function heartbeatBuild(id: string, workerId: string): boolean {
  const lease = new Date(Date.now() + config.leaseMinutes * 60_000).toISOString();
  const result = db()
    .prepare("UPDATE builds SET lease_expires_at = ? WHERE id = ? AND status = 'running' AND worker_id = ?")
    .run(lease, id, workerId);
  return Number(result.changes) === 1;
}

export function failBuild(id: string, workerId: string, error: string, retryable: boolean): boolean {
  return tx((conn) => {
    const build = getBuild(id);
    if (!build || build.status !== "running" || build.workerId !== workerId) return false;
    const requeue = retryable && build.attempts < config.maxBuildAttempts;
    conn
      .prepare(
        `UPDATE builds SET status = ?, error = ?, worker_id = NULL, lease_expires_at = NULL,
           finished_at = ? WHERE id = ?`,
      )
      .run(requeue ? "queued" : "failed", error.slice(0, 4000), requeue ? null : now(), id);
    return true;
  });
}

/**
 * The "never gets worse" rule: a new version becomes current only if it scores a
 * higher likeness than the current one. Unscored versions never auto-replace a
 * current version; the owner can still promote them by hand.
 */
export function shouldPromote(current: Pick<Version, "likeness"> | null, candidate: number | null): boolean {
  if (!current) return true;
  if (candidate === null) return false;
  if (current.likeness === null) return true;
  return candidate > current.likeness;
}

export function completeBuild(
  id: string,
  workerId: string,
  result: {
    likeness: number | null;
    engineVersion: string | null;
    backend: string;
    rigChecks: Record<string, unknown>;
    files: VersionFiles;
  },
): { version: Version; promoted: boolean } | null {
  return tx((conn) => {
    const build = getBuild(id);
    if (!build || build.status !== "running" || build.workerId !== workerId) return null;
    const avatar = getAvatar(build.avatarId);
    if (!avatar) return null;

    const { n } = conn
      .prepare("SELECT COALESCE(MAX(number), 0) AS n FROM versions WHERE avatar_id = ?")
      .get(avatar.id) as { n: number };
    const versionId = newId("ver");
    const ts = now();
    conn
      .prepare(
        `INSERT INTO versions (id, avatar_id, build_id, number, likeness, engine_version, backend,
           rig_checks_json, files_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        versionId,
        avatar.id,
        build.id,
        Number(n) + 1,
        result.likeness,
        result.engineVersion,
        result.backend,
        JSON.stringify(result.rigChecks),
        JSON.stringify(result.files),
        ts,
      );
    conn
      .prepare("UPDATE builds SET status = 'succeeded', error = NULL, lease_expires_at = NULL, finished_at = ? WHERE id = ?")
      .run(ts, build.id);

    const current = avatar.currentVersionId ? getVersion(avatar.currentVersionId) : null;
    const promoted = shouldPromote(current, result.likeness);
    conn
      .prepare("UPDATE avatars SET current_version_id = ?, updated_at = ? WHERE id = ?")
      .run(promoted ? versionId : avatar.currentVersionId, ts, avatar.id);

    return { version: getVersion(versionId)!, promoted };
  });
}

// ---------------------------------------------------------------------------
// Versions

export function getVersion(id: string): Version | null {
  const row = db().prepare("SELECT * FROM versions WHERE id = ?").get(id);
  return row ? toVersion(row) : null;
}

export function listVersions(avatarId: string): Version[] {
  return db().prepare("SELECT * FROM versions WHERE avatar_id = ? ORDER BY number DESC").all(avatarId).map(toVersion);
}

export function setCurrentVersion(avatarId: string, versionId: string): void {
  db().prepare("UPDATE avatars SET current_version_id = ?, updated_at = ? WHERE id = ?").run(versionId, now(), avatarId);
}

function touchAvatar(avatarId: string): void {
  db().prepare("UPDATE avatars SET updated_at = ? WHERE id = ?").run(now(), avatarId);
}
