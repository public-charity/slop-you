import Link from "next/link";
import { listAvatarsForOwner, listDemoAvatars, type AvatarSummary } from "@/lib/db";
import { readSessionId } from "@/lib/session";
import { fileUrl } from "@/lib/view";

function AvatarCard({ avatar: a }: { avatar: AvatarSummary }) {
  return (
    <Link href={`/avatars/${a.id}`} className="card flex gap-4 p-4 transition hover:border-ink/40">
      <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-line/50">
        {a.current?.files.preview && (
          // eslint-disable-next-line @next/next/no-img-element -- private, cookie-authed file route
          <img src={fileUrl(a.current.files.preview)} alt="" className="size-full object-cover object-top" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-semibold">{a.name}</span>
        <span className="text-sm text-muted">
          {a.photoCount} photo{a.photoCount === 1 ? "" : "s"}
          {a.current ? ` · v${a.current.number}` : ""}
        </span>
        {a.latestBuild && <span className="font-mono text-xs text-muted">{a.latestBuild.status}</span>}
      </div>
    </Link>
  );
}

const STEPS = [
  {
    title: "Four photos",
    body: "Front, both three-quarter angles, and a profile. Your browser checks pose, focus and lighting before anything uploads.",
  },
  {
    title: "Built in Unreal",
    body: "Your photos drive a MetaHuman conform, then Epic's auto-rigger adds the full face and body rig. Every build passes a rig check.",
  },
  {
    title: "Drop it in UE 5.8+",
    body: "Download a package for your project's Content folder, plus a DCC export and DNA files for Maya or Blender.",
  },
];

export default async function Home() {
  const sid = await readSessionId();
  const avatars = sid ? listAvatarsForOwner(sid) : [];
  const demos = listDemoAvatars();

  return (
    <div className="flex flex-col gap-16 pt-8 sm:pt-16">
      <section className="flex flex-col gap-6">
        <p className="eyebrow">Photos in, MetaHuman out</p>
        <h1 className="max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
          Your face, as a fully rigged MetaHuman.
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          Upload a few photos and get a character you can animate in Unreal Engine 5 right away. Add more photos
          whenever you like. A rebuild only replaces your current version when it looks more like you.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/create" className="btn btn-primary">
            Make yours
          </Link>
          {avatars.length > 0 && (
            <a href="#yours" className="btn btn-ghost">
              Your avatars ({avatars.length})
            </a>
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <div key={step.title} className="card flex flex-col gap-2 p-5">
            <span className="font-mono text-sm text-muted">0{i + 1}</span>
            <h2 className="text-lg font-semibold">{step.title}</h2>
            <p className="text-sm text-muted">{step.body}</p>
          </div>
        ))}
      </section>

      {avatars.length > 0 && (
        <section id="yours" className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold tracking-tight">Your avatars</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {avatars.map((a) => (
              <AvatarCard key={a.id} avatar={a} />
            ))}
          </div>
        </section>
      )}

      {demos.length > 0 && (
        <section id="demos" className="flex flex-col gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Demo gallery</h2>
            <p className="text-sm text-muted">Built from public-domain photographs of historical figures.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {demos.map((a) => (
              <AvatarCard key={a.id} avatar={a} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
