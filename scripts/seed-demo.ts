// Seeds read-only demo avatars from public-domain portraits on Wikimedia Commons
// (demo/people.json) and queues a build for each. Run a worker to process them.
//
//   npm run seed:demo              add any demo avatars that don't exist yet
//   npm run seed:demo -- --reset   delete all demo avatars first
//
// Policy: only historical figures who died before DEATH_CUTOFF, so post-mortem
// publicity rights (up to 100 years in some US states) have lapsed, and only
// photos Commons marks as public domain. Never add living or recent figures.

import fs from "node:fs";
import path from "node:path";
import { config } from "../src/lib/config";
import {
  addPhoto,
  createBuild,
  createDemoAvatar,
  defaultBuildOptions,
  deleteAvatar,
  listDemoAvatars,
  newId,
} from "../src/lib/db";
import { normalizePhoto } from "../src/lib/images";
import { keys, putBuffer, removePrefix } from "../src/lib/storage";

const DEATH_CUTOFF = 1926;
const USER_AGENT = "slop.you-demo-seed/0.1 (https://github.com/public-charity/slop-you)";

type Person = {
  name: string;
  died: number;
  file: string;
  credit: { author: string; date: string; license: string };
};

type ImageInfo = { url: string; thumburl?: string; width: number; height: number };
type CommonsResponse = { query?: { pages?: Record<string, { imageinfo?: ImageInfo[] }> } };

const commonsPage = (file: string) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replace(/ /g, "_"))}`;

async function downloadUrl(file: string): Promise<string> {
  const api = new URL("https://commons.wikimedia.org/w/api.php");
  api.search = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "imageinfo",
    iiprop: "url|size",
    iiurlwidth: "1600",
    titles: `File:${file}`,
  }).toString();
  const res = await fetch(api, { headers: { "User-Agent": USER_AGENT } });
  const data = (await res.json()) as CommonsResponse;
  const info = Object.values(data.query?.pages ?? {})[0]?.imageinfo?.[0];
  if (!info) throw new Error(`Not found on Commons: ${file}`);
  return info.width > 1600 && info.thumburl ? info.thumburl : info.url;
}

async function main() {
  const people = JSON.parse(fs.readFileSync(path.join(process.cwd(), "demo", "people.json"), "utf8")) as Person[];

  if (process.argv.includes("--reset")) {
    for (const avatar of listDemoAvatars()) {
      await removePrefix(keys.avatarPrefix(avatar.id));
      deleteAvatar(avatar.id);
      console.log(`removed ${avatar.name}`);
    }
  }

  const existing = new Set(listDemoAvatars().map((a) => a.name));
  for (const person of people) {
    if (person.died >= DEATH_CUTOFF) throw new Error(`${person.name} died in ${person.died}; demo figures must have died before ${DEATH_CUTOFF}.`);
    if (existing.has(person.name)) {
      console.log(`skip   ${person.name} (already seeded)`);
      continue;
    }

    const url = await downloadUrl(person.file);
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`Download failed for ${person.name}: HTTP ${res.status}`);
    const { data, info } = await normalizePhoto(Buffer.from(await res.arrayBuffer()));
    if (Math.min(info.width, info.height) < config.minPhotoShortSide) {
      throw new Error(`${person.file} is only ${info.width}×${info.height}`);
    }

    const avatar = createDemoAvatar(person.name);
    const photoId = newId("ph");
    const storageKey = keys.photo(avatar.id, photoId);
    await putBuffer(storageKey, data);
    addPhoto({
      id: photoId,
      avatarId: avatar.id,
      slot: "front",
      storageKey,
      width: info.width,
      height: info.height,
      checks: {},
      credit: { ...person.credit, title: person.file, url: commonsPage(person.file) },
    });
    createBuild(avatar.id, [photoId], defaultBuildOptions());
    console.log(`seeded ${person.name} (${info.width}×${info.height}, ${Math.round(data.length / 1024)} KB), build queued`);

    await new Promise((r) => setTimeout(r, 500)); // be gentle with Commons
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
