// Thumbnail._regenerate_thumbnails for still images (port of
// lp_ingest::Pipeline::regenerate_thumbnails and the libvips renderer):
// delete the files, render the big WebP (<= 1080 px high, EXIF autorotation
// plus local_orientation, Q95 effort 2) and the 500 / 250 px squares from it,
// then store the names, the aspect ratio and the big thumbnail's pHash.
// Decoders: sharp (libvips); for files it rejects (HEIC, JPEG XL...) Pillow
// through the Python interpreter, as image_decoding._pillow_to_vips does.
// TODO(merge): unify with the ingest port's renderer.
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp, { type OutputInfo, type Sharp } from "sharp";
import { sql } from "drizzle-orm";
import { config } from "~/lib/config";
import { db, row } from "~/lib/db";
import { phashWebpFile } from "./phash";

const BIG = "thumbnails_big";
const SQUARE = "square_thumbnails";
const SQUARE_SMALL = "square_thumbnails_small";
const HEIGHT: Record<string, number> = { [BIG]: 1080, [SQUARE]: 500, [SQUARE_SMALL]: 250 };
const WEBP_Q = 95;
const SMALL_Q = (() => {
  const q = Number(process.env.LP_THUMB_SMALL_Q);
  return Number.isInteger(q) && q >= 1 && q <= 100 ? q : 80;
})();
const EFFORT = 2;

const thumbPath = (dir: string, hash: string, ext: string) => path.join(config.mediaRoot, dir, `${hash}${ext}`);
/** os.path.join(dir, hash + ext), the name stored in api_thumbnail. */
const storedName = (dir: string, hash: string, ext: string) => `${dir}${path.sep}${hash}${ext}`;

/** delete_thumbnail_files */
async function deleteThumbnailFiles(hash: string) {
  for (const [dir, ext] of [
    [BIG, ".webp"],
    [SQUARE, ".webp"],
    [SQUARE_SMALL, ".webp"],
    [SQUARE, ".mp4"],
    [SQUARE_SMALL, ".mp4"],
  ])
    await rm(thumbPath(dir, hash, ext), { force: true }).catch((e) => console.error(`could not remove thumbnail: ${e}`));
}

type Raw = { data: Buffer; info: OutputInfo };

/** vips_thumbnail(file, 10000, height=H, size=down): EXIF-autorotated, shrunk to fit. */
async function shrink(file: string, height: number): Promise<Raw> {
  // A buffer, not the path: libvips' cache would keep the file open, and on
  // Windows ExifTool's -overwrite_original rename of it would then fail.
  const input = await readFile(file);
  return sharp(input, { failOn: "none", limitInputPixels: 250_000_000 })
    .autoOrient()
    .resize({ width: 10000, height, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
}

/** Pillow + pillow-heif/jxl decode, EXIF-transposed, RGB, into a temp PNG. */
async function pillowDecode(input: string): Promise<{ png: string; dir: string }> {
  const script = `import sys
from PIL import Image, ImageOps
try:
    import pillow_heif; pillow_heif.register_heif_opener()
except Exception:
    pass
try:
    import pillow_jxl
except Exception:
    pass
Image.MAX_IMAGE_PIXELS = 250_000_000
with Image.open(sys.argv[1]) as image:
    ImageOps.exif_transpose(image).convert('RGB').save(sys.argv[2], 'PNG', compress_level=1)
`;
  const dir = await mkdtemp(path.join(tmpdir(), "lp-decode-"));
  const png = path.join(dir, "decoded.png");
  const p = Bun.spawn([config.python, "-c", script, input, png], { stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  if (code !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`no decoder for ${input}: ${err.trim().slice(-2000) || "no output"}`);
  }
  return { png, dir };
}

async function decode(input: string, height: number): Promise<Raw> {
  try {
    return await shrink(input, height);
  } catch (vipsErr) {
    const { png, dir } = await pillowDecode(input).catch((e) => {
      throw new Error(`${e.message} (libvips: ${vipsErr})`);
    });
    try {
      return await shrink(png, height);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

const fromRaw = (r: Raw) => sharp(r.data, { raw: { width: r.info.width, height: r.info.height, channels: r.info.channels } });

/**
 * render::orient: local_orientation on top of the EXIF autorotation (vips
 * rot(D90) is clockwise, like sharp's angles). sharp mirrors before it
 * rotates within one pipeline, so rotate-then-mirror takes two passes.
 */
async function orient(img: Raw, o: number): Promise<Raw> {
  const pass = (s: Sharp) => s.raw().toBuffer({ resolveWithObject: true });
  switch (o) {
    case 2:
      return pass(fromRaw(img).flop());
    case 3:
      return pass(fromRaw(img).rotate(180));
    case 4:
      return pass(fromRaw(img).flip());
    case 5:
      return pass(fromRaw(await pass(fromRaw(img).rotate(90))).flop());
    case 6:
      return pass(fromRaw(img).rotate(270));
    case 7:
      return pass(fromRaw(await pass(fromRaw(img).rotate(270))).flop());
    case 8:
      return pass(fromRaw(img).rotate(90));
    default:
      return img;
  }
}

/** Python round(w / h, 2). */
const aspectRatio = (w: number, h: number) => (h ? Number((w / h).toFixed(2)) : null);

/** Render the three static thumbnails; returns the big one's size. */
async function renderStatic(input: string, hash: string, localOrientation: number) {
  for (const d of [BIG, SQUARE, SQUARE_SMALL]) await mkdir(path.join(config.mediaRoot, d), { recursive: true });
  const decoded = await decode(input, HEIGHT[BIG]);
  const big = await orient(decoded, localOrientation);
  await fromRaw(big).webp({ quality: WEBP_Q, effort: EFFORT }).toFile(thumbPath(BIG, hash, ".webp"));
  for (const dir of [SQUARE, SQUARE_SMALL]) {
    await fromRaw(big)
      .resize({ width: 10000, height: HEIGHT[dir], fit: "inside", withoutEnlargement: true })
      .webp({ quality: SMALL_Q, effort: EFFORT })
      .toFile(thumbPath(dir, hash, ".webp"));
  }
  return { width: big.info.width, height: big.info.height };
}

/** Thumbnail._regenerate_thumbnails for a still photo (rotate never sees videos). */
export async function regenerateThumbnails(photoId: string): Promise<void> {
  const p = await row<{ image_hash: string; local_orientation: number; video: boolean; path: string | null }>(
    sql`SELECT p.image_hash, p.local_orientation, p.video, f.path FROM api_photo p
      LEFT JOIN api_file f ON f.hash = p.main_file_id WHERE p.id = ${photoId}`,
  );
  if (!p) throw new Error(`photo ${photoId} vanished`);
  if (!p.path) return;
  if (p.video) throw new Error("video thumbnails are rendered by the scan");
  await db.execute(sql`INSERT INTO api_thumbnail (photo_id, thumbnail_big, square_thumbnail, square_thumbnail_small)
    VALUES (${photoId}, '', '', '') ON CONFLICT DO NOTHING`);
  await deleteThumbnailFiles(p.image_hash);
  const { width, height } = await renderStatic(p.path, p.image_hash, p.local_orientation);
  const phash = await phashWebpFile(thumbPath(BIG, p.image_hash, ".webp"));
  const aspect = width > 0 && height > 0 ? aspectRatio(width, height) : null;
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE api_thumbnail SET thumbnail_big = ${storedName(BIG, p.image_hash, ".webp")},
        square_thumbnail = ${storedName(SQUARE, p.image_hash, ".webp")},
        square_thumbnail_small = ${storedName(SQUARE_SMALL, p.image_hash, ".webp")},
        aspect_ratio = COALESCE(${aspect}::float8, aspect_ratio) WHERE photo_id = ${photoId}`);
    if (phash) await tx.execute(sql`UPDATE api_photo SET perceptual_hash = ${phash} WHERE id = ${photoId}`);
  });
}
