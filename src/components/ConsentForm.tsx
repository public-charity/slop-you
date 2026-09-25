"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CONSENT_ITEMS, CONSENT_VERSION, type ConsentId } from "@/lib/consent";

export function ConsentForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [checked, setChecked] = useState<Partial<Record<ConsentId, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const complete = name.trim() !== "" && CONSENT_ITEMS.every((item) => checked[item.id]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/avatars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, consentVersion: CONSENT_VERSION, consent: checked }),
    });
    if (!res.ok) {
      setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Something went wrong.");
      setBusy(false);
      return;
    }
    const { id } = (await res.json()) as { id: string };
    router.push(`/avatars/${id}`);
  }

  return (
    <form onSubmit={submit} className="card flex flex-col gap-6 p-6">
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Avatar name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="e.g. Me, summer 2026"
          className="rounded-xl border border-line bg-bg px-4 py-3 outline-none focus:border-ink"
        />
      </label>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-semibold">Please confirm</legend>
        {CONSENT_ITEMS.map((item) => (
          <label key={item.id} className="flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={Boolean(checked[item.id])}
              onChange={(e) => setChecked((prev) => ({ ...prev, [item.id]: e.target.checked }))}
              className="mt-0.5 size-4 accent-[var(--ink)]"
            />
            <span>{item.text}</span>
          </label>
        ))}
      </fieldset>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button type="submit" disabled={!complete || busy} className="btn btn-primary self-start">
        {busy ? "Creating…" : "Continue to photos"}
      </button>
    </form>
  );
}
