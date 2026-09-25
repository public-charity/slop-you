"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SLOTS } from "@/lib/capture";
import type { VersionFileName } from "@/lib/db";
import { preloadFaceChecks } from "@/lib/face-check";
import type { AvatarView, VersionView } from "@/lib/view";
import { PhotoSlotCard } from "./PhotoSlotCard";

type Quality = "MEDIUM" | "HIGH" | "CINEMATIC";

const DOWNLOADS: { file: VersionFileName; label: (v: VersionView) => string; note: string }[] = [
  { file: "uePackage", label: (v) => `UE ${v.engineVersion ?? "5"}+ package`, note: "Unzip into your project's Content folder" },
  { file: "dcc", label: () => "DCC export", note: "Maya, Blender, Houdini" },
  { file: "dna", label: () => "DNA files", note: "RigLogic head and body rigs" },
  { file: "manifest", label: () => "Manifest", note: "Rig checks and build settings" },
];

const pct = (n: number | null) => (n === null ? "unscored" : `${Math.round(n * 100)}%`);

function When({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {new Date(iso).toLocaleString()}
    </time>
  );
}

export function AvatarWorkspace({ initial }: { initial: AvatarView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [quality, setQuality] = useState<Quality>("HIGH");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/avatars/${view.id}`, { cache: "no-store" });
    if (res.ok) setView((await res.json()) as AvatarView);
  }, [view.id]);

  useEffect(() => preloadFaceChecks(), []);

  const building = view.activeBuild !== null;
  useEffect(() => {
    if (!building) return;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [building, refresh]);

  async function startBuild() {
    setBusy(true);
    setActionError(null);
    const res = await fetch(`/api/avatars/${view.id}/builds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quality }),
    });
    if (!res.ok) setActionError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't start the build.");
    await refresh();
    setBusy(false);
  }

  async function promote(versionId: string) {
    await fetch(`/api/avatars/${view.id}/versions/${versionId}/promote`, { method: "POST" });
    await refresh();
  }

  async function deleteAvatar() {
    if (!window.confirm(`Delete "${view.name}", all its photos and every version? This can't be undone.`)) return;
    await fetch(`/api/avatars/${view.id}`, { method: "DELETE" });
    router.push("/");
    router.refresh();
  }

  const current = view.versions.find((v) => v.isCurrent) ?? null;
  const latest = view.versions[0] ?? null;
  const lastBuild = view.builds[0] ?? null;

  return (
    <div className="flex flex-col gap-10 pt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Avatar</p>
          <h1 className="text-3xl font-bold tracking-tight">{view.name}</h1>
        </div>
        <button type="button" onClick={deleteAvatar} className="btn btn-danger">
          Delete avatar
        </button>
      </div>

      {/* Current version */}
      <section className="card grid gap-6 p-5 sm:grid-cols-[220px_1fr]">
        <div className="aspect-square overflow-hidden rounded-xl bg-line/50">
          {current?.files.preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- private, cookie-authed file route
            <img src={current.files.preview} alt={`${view.name}, version ${current.number}`} className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center p-6 text-center text-sm text-muted">
              Your MetaHuman preview appears here after the first build.
            </div>
          )}
        </div>
        <div className="flex flex-col gap-4">
          {current ? (
            <>
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-2xl font-bold">Version {current.number}</h2>
                <span className="font-mono text-sm">likeness {pct(current.likeness)}</span>
                {current.backend === "mock" && (
                  <span className="rounded-full border border-warn px-2 py-0.5 font-mono text-xs text-warn">mock build</span>
                )}
              </div>
              {latest && !latest.isCurrent && (
                <p className="text-sm text-muted">
                  Version {latest.number} scored {pct(latest.likeness)}, which didn&apos;t beat version {current.number}, so
                  version {current.number} is still current. You can switch versions below.
                </p>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                {DOWNLOADS.filter((d) => current.files[d.file]).map((d) => (
                  <a key={d.file} href={current.files[d.file]} className="rounded-xl border border-line p-3 transition hover:border-ink/40">
                    <span className="block font-semibold">{d.label(current)}</span>
                    <span className="text-sm text-muted">{d.note}</span>
                  </a>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-bold">No build yet</h2>
              <p className="text-muted">Add the three required photos below, then build your MetaHuman.</p>
            </div>
          )}
        </div>
      </section>

      {/* Photos */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-bold">Photos</h2>
          <p className="text-sm text-muted">
            Every build uses all of these. Adding more angles later gives the next build more to work with.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SLOTS.map((slot) => (
            <PhotoSlotCard
              key={slot.id}
              slot={slot}
              avatarId={view.id}
              photos={view.photos.filter((p) => p.slot === slot.id)}
              onChange={refresh}
            />
          ))}
        </div>
      </section>

      {/* Build */}
      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-xl font-bold">Build</h2>
        {view.activeBuild ? (
          <div className="flex items-center gap-3">
            <span className="size-2.5 animate-pulse rounded-full bg-accent ring-4 ring-accent/30" />
            <p>
              {view.activeBuild.status === "queued"
                ? "Queued. Waiting for an Unreal build machine…"
                : `Building in Unreal (attempt ${view.activeBuild.attempts}). Conform, auto-rig, textures, assembly.`}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              Quality
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as Quality)}
                className="rounded-full border border-line bg-bg px-3 py-2"
              >
                <option value="MEDIUM">Medium (game-ready)</option>
                <option value="HIGH">High</option>
                <option value="CINEMATIC">Cinematic</option>
              </select>
            </label>
            <button type="button" onClick={startBuild} disabled={!view.canBuild.ok || busy} className="btn btn-primary">
              {view.versions.length ? `Rebuild with ${view.photos.length} photos` : "Build my MetaHuman"}
            </button>
          </div>
        )}
        {!view.activeBuild && !view.canBuild.ok && view.canBuild.reason && (
          <p className="text-sm text-muted">{view.canBuild.reason}</p>
        )}
        {actionError && <p className="text-sm text-danger">{actionError}</p>}
        {!view.activeBuild && lastBuild?.status === "failed" && (
          <p className="text-sm text-danger">Last build failed: {lastBuild.error ?? "unknown error"}</p>
        )}
      </section>

      {/* History */}
      {view.versions.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-bold">Versions</h2>
          <ol className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card">
            {view.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-4 p-4">
                <span className="w-10 font-mono text-sm">v{v.number}</span>
                <div className="flex min-w-40 flex-1 items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-ink" style={{ width: `${Math.round((v.likeness ?? 0) * 100)}%` }} />
                  </div>
                  <span className="w-20 font-mono text-xs">{pct(v.likeness)}</span>
                </div>
                <span className="text-xs text-muted">
                  <When iso={v.createdAt} /> · {v.backend}
                </span>
                {v.isCurrent ? (
                  <span className="rounded-full bg-accent px-3 py-1 font-mono text-xs text-accent-ink">current</span>
                ) : (
                  <button type="button" onClick={() => promote(v.id)} className="btn btn-ghost px-3 py-1 text-xs">
                    Make current
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
