import sharp from "sharp";

/** Re-encodes to JPEG: applies EXIF orientation and drops all metadata (including GPS). */
export function normalizePhoto(input: Buffer) {
  return sharp(input, { limitInputPixels: 80_000_000 }).rotate().jpeg({ quality: 92 }).toBuffer({ resolveWithObject: true });
}
