import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "slop.you",
  description: "Turn a few photos of yourself into a fully rigged MetaHuman for Unreal Engine 5.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5 sm:px-6">
          <Link href="/" className="font-mono text-lg font-bold tracking-tight">
            slop<span className="rounded bg-accent px-1 text-accent-ink">.you</span>
          </Link>
          <Link href="/create" className="btn btn-ghost">
            New avatar
          </Link>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 sm:px-6">{children}</main>
        <footer className="mx-auto w-full max-w-5xl px-4 py-8 text-xs text-muted sm:px-6">
          Avatars are built as MetaHuman characters for Unreal Engine 5.8 and later. slop.you is not affiliated with Epic Games.
        </footer>
      </body>
    </html>
  );
}
