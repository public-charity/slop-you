// Browser-side photo checks. They catch bad photos before upload (the UE conform
// needs a clear, well-lit face) and re-encode to JPEG so EXIF/GPS never leaves the device.
// Results are advisory: the server re-validates size and format.

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import type { Slot } from "./capture";

// Copied from node_modules by scripts/copy-mediapipe.mjs so the wasm always matches the package version.
const WASM_BASE = "/mediapipe/wasm";
const MODEL_URL =
  process.env.NEXT_PUBLIC_FACE_MODEL_URL ??
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const MIN_SHORT_SIDE = 720;
const MAX_LONG_SIDE = 4096;
const ANALYSIS_SIZE = 640;

export type CheckResult = {
  errors: string[];
  warnings: string[];
  metrics: { width: number; height: number; faces: number | null; yaw: number | null; sharpness: number; brightness: number };
  jpeg: Blob | null;
};

let landmarker: Promise<FaceLandmarker | null> | null = null;

function getLandmarker(): Promise<FaceLandmarker | null> {
  landmarker ??= (async () => {
    try {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const create = (delegate: "GPU" | "CPU") =>
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: "IMAGE",
          numFaces: 2,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
      return await create("GPU").catch(() => create("CPU"));
    } catch (err) {
      console.warn("Face checks unavailable:", err);
      return null;
    }
  })();
  return landmarker;
}

/** Start downloading the model early, e.g. when the workspace mounts. */
export function preloadFaceChecks(): void {
  void getLandmarker();
}

export async function checkPhoto(file: File, slot: Slot): Promise<CheckResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file); // applies EXIF orientation
  } catch {
    return {
      errors: ["Your browser couldn't read that image. Try a JPEG or PNG."],
      warnings,
      metrics: { width: 0, height: 0, faces: null, yaw: null, sharpness: 0, brightness: 0 },
      jpeg: null,
    };
  }

  const { width, height } = bitmap;
  if (Math.min(width, height) < MIN_SHORT_SIDE) {
    errors.push(`Too small (${width}×${height}). The shorter side needs at least ${MIN_SHORT_SIDE}px.`);
  }

  // Small copy for analysis.
  const scale = Math.min(1, ANALYSIS_SIZE / Math.max(width, height));
  const small = drawToCanvas(bitmap, Math.round(width * scale), Math.round(height * scale));
  const { brightness, sharpness } = measure(small);
  if (brightness < 60) warnings.push("It's quite dark. Face a window or a lamp.");
  if (brightness > 215) warnings.push("It's overexposed. Move out of direct light.");
  if (sharpness < 35) warnings.push("It looks blurry. Hold still or tap to focus.");

  let faces: number | null = null;
  let yaw: number | null = null;
  const detector = await getLandmarker();
  if (!detector) {
    warnings.push("Face checks couldn't load, so pose and expression weren't checked.");
  } else {
    const result = detector.detect(small);
    faces = result.faceLandmarks.length;
    const poseMatters = slot.yaw !== null;

    if (faces === 0) {
      (poseMatters ? errors : warnings).push("No face found. Make sure your whole face is in frame.");
    } else if (faces > 1) {
      errors.push("There's more than one face. Only you should be in the photo.");
    } else {
      const matrix = result.facialTransformationMatrixes[0]?.data;
      yaw = matrix ? yawDegrees(matrix) : null;
      if (yaw !== null && slot.yaw) {
        const [min, max] = slot.yaw;
        if (yaw > max) {
          warnings.push(slot.id === "front" ? "Face the camera straight on." : `Turn back a little (about ${Math.round(yaw)}° now).`);
        } else if (yaw < min) {
          warnings.push(`Turn your head a bit more (about ${Math.round(yaw)}° now).`);
        }
      }

      const box = boundingWidth(result.faceLandmarks[0]);
      if (box < 0.15) warnings.push("Your face is small in the frame. Move closer.");

      const score = (name: string) => result.faceBlendshapes[0]?.categories.find((c) => c.categoryName === name)?.score ?? 0;
      if (score("eyeBlinkLeft") > 0.6 && score("eyeBlinkRight") > 0.6) errors.push("Your eyes look closed.");
      if ((score("mouthSmileLeft") + score("mouthSmileRight")) / 2 > 0.5) warnings.push("A neutral face works best: try not to smile.");
      if (score("jawOpen") > 0.3) warnings.push("Close your mouth for this one.");
    }
  }

  // Full-resolution re-encode (capped) for upload. Drops all metadata.
  const outScale = Math.min(1, MAX_LONG_SIDE / Math.max(width, height));
  const full = drawToCanvas(bitmap, Math.round(width * outScale), Math.round(height * outScale));
  bitmap.close();
  const jpeg = errors.length ? null : await new Promise<Blob | null>((resolve) => full.toBlob(resolve, "image/jpeg", 0.95));

  return {
    errors,
    warnings,
    metrics: { width, height, faces, yaw, sharpness, brightness },
    jpeg,
  };
}

function drawToCanvas(bitmap: ImageBitmap, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

/** Mean luminance (0-255) and variance of the Laplacian (a standard focus measure). */
function measure(canvas: HTMLCanvasElement): { brightness: number; sharpness: number } {
  const { width: w, height: h } = canvas;
  const { data } = canvas.getContext("2d")!.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = g;
    sum += g;
  }
  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const mean = n ? lapSum / n : 0;
  return { brightness: sum / (w * h), sharpness: n ? lapSq / n - mean * mean : 0 };
}

/**
 * Absolute head yaw in degrees from MediaPipe's 4x4 face transform.
 * Taking the magnitude and folding around 90° makes this independent of the
 * matrix's row/column order and of whether the canonical face points toward +Z or -Z.
 */
function yawDegrees(m: number[]): number {
  const deg = Math.abs((Math.atan2(m[8], m[10]) * 180) / Math.PI);
  return Math.min(deg, 180 - deg);
}

function boundingWidth(points: { x: number }[]): number {
  let min = 1;
  let max = 0;
  for (const p of points) {
    if (p.x < min) min = p.x;
    if (p.x > max) max = p.x;
  }
  return Math.max(0, max - min);
}
