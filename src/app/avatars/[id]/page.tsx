import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AvatarWorkspace } from "@/components/AvatarWorkspace";
import { ownedAvatar } from "@/lib/session";
import { avatarView } from "@/lib/view";

export const metadata: Metadata = { title: "Avatar · slop.you" };

export default async function AvatarPage({ params }: PageProps<"/avatars/[id]">) {
  const { id } = await params;
  const avatar = await ownedAvatar(id);
  if (!avatar) notFound();
  return <AvatarWorkspace initial={avatarView(avatar)} />;
}
