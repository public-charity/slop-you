import type { Metadata } from "next";
import { ConsentForm } from "@/components/ConsentForm";

export const metadata: Metadata = { title: "New avatar · slop.you" };

export default function CreatePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 pt-8">
      <div className="flex flex-col gap-2">
        <p className="eyebrow">Step 1 of 2</p>
        <h1 className="text-3xl font-bold tracking-tight">Before you upload</h1>
        <p className="text-muted">
          slop.you builds avatars of the person holding the camera. Name your avatar and confirm the points below.
        </p>
      </div>
      <ConsentForm />
    </div>
  );
}
