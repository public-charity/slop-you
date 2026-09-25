// Copies MediaPipe's wasm runtime into public/ so the browser loads the exact
// version that matches @mediapipe/tasks-vision in package.json.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const to = join(root, "public", "mediapipe", "wasm");

if (!existsSync(from)) {
  console.warn("[copy-mediapipe] @mediapipe/tasks-vision is not installed; skipping.");
  process.exit(0);
}
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
console.log("[copy-mediapipe] wasm copied to public/mediapipe/wasm");
