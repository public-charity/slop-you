"use client";

import { useRef, useState } from "react";
import type { Slot } from "@/lib/capture";
import { checkPhoto } from "@/lib/face-check";
import type { PhotoView } from "@/lib/view";

type Phase = "idle" | "checking" | "uploading";

export function PhotoSlotCard({
  slot,
  avatarId,
  photos,
  onChange,
  readOnly = false,
}: {
  slot: Slot;
  avatarId: string;
  photos: PhotoView[];
  onChange: () => void;
  readOnly?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handleFile(file: File) {
    setErrors([]);
    setWarnings([]);
    setPhase("checking");
    const result = await checkPhoto(file, slot);
    setWarnings(result.warnings);
    if (result.errors.length || !result.jpeg) {
      setErrors(result.errors.length ? result.errors : ["Couldn't prepare that photo."]);
      setPhase("idle");
      return;
    }

    setPhase("uploading");
    const form = new FormData();
    form.set("file", new File([result.jpeg], `${slot.id}.jpg`, { type: "image/jpeg" }));
    form.set("slot", slot.id);
    form.set(
      "checks",
      JSON.stringify({
        yaw: result.metrics.yaw,
        sharpness: Math.round(result.metrics.sharpness),
        brightness: Math.round(result.metrics.brightness),
        warnings: result.warnings,
      }),
    );
    const res = await fetch(`/api/avatars/${avatarId}/photos`, { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setErrors([body?.error ?? "Upload failed."]);
    }
    setPhase("idle");
    onChange();
  }

  async function remove(photoId: string) {
    await fetch(`/api/avatars/${avatarId}/photos/${photoId}`, { method: "DELETE" });
    onChange();
  }

  const done = photos.length > 0;

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">
            {slot.label}
            {!slot.required && <span className="ml-2 font-mono text-xs font-normal text-muted">optional</span>}
          </h3>
          <p className="text-sm text-muted">{slot.hint}</p>
        </div>
        {done && <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-xs text-accent-ink">✓</span>}
      </div>

      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <div key={p.id} className="group relative size-20 overflow-hidden rounded-lg bg-line/50">
              {/* eslint-disable-next-line @next/next/no-img-element -- private, cookie-authed file route */}
              <img src={p.url} alt={`${slot.label} photo`} className="size-full object-cover" />
              {p.warnings.length > 0 && (
                <span
                  title={p.warnings.join("\n")}
                  className="absolute bottom-1 left-1 rounded bg-warn px-1 font-mono text-[10px] text-bg"
                >
                  !
                </span>
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  aria-label="Delete photo"
                  className="absolute right-1 top-1 rounded-full bg-ink/70 px-1.5 text-xs text-bg opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {photos
        .filter((p) => p.credit)
        .map((p) => (
          <p key={`credit-${p.id}`} className="text-xs text-muted">
            Photo: {p.credit!.author}, {p.credit!.date}. {p.credit!.license}.{" "}
            <a href={p.credit!.url} target="_blank" rel="noreferrer" className="underline">
              Source
            </a>
          </p>
        ))}

      {errors.map((e) => (
        <p key={e} className="text-sm text-danger">
          {e}
        </p>
      ))}
      {warnings.map((w) => (
        <p key={w} className="text-sm text-warn">
          {w}
        </p>
      ))}

      {!readOnly && (
        <>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />
          <button
            type="button"
            disabled={phase !== "idle"}
            onClick={() => input.current?.click()}
            className="btn btn-ghost self-start"
          >
            {phase === "checking" ? "Checking…" : phase === "uploading" ? "Uploading…" : done ? "Add another" : "Add photo"}
          </button>
        </>
      )}
    </div>
  );
}
