// User.avatar (ImageField(upload_to="avatars")): DRF's file checks, Django's
// image check and FileSystemStorage.save naming. Port of
// lp_api::users_settings::avatar.
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { randomInt } from "node:crypto";
import sharp from "sharp";
import { config } from "~/lib/config";
import { ApiError } from "~/lib/errors";
import type { InputValue, UploadedFile } from "./input";

const MAX_NAME = 100;

/** null clears the avatar, a file is an upload, a string is a DRF message. */
export async function validateAvatar(raw: InputValue): Promise<{ file: UploadedFile | null } | { error: string }> {
  if ("value" in raw) {
    if (raw.value === null) return { file: null };
    return { error: "The submitted data was not a file. Check the encoding type on the form." };
  }
  const f = raw.file;
  if (!f.filename) return { error: "No filename could be determined." };
  if (!f.bytes.length) return { error: "The submitted file is empty." };
  const len = [...f.filename].length;
  if (len > MAX_NAME) return { error: `Ensure this filename has at most ${MAX_NAME} characters (it has ${len}).` };
  try {
    const m = await sharp(f.bytes).metadata();
    if (!m.format || !m.width) throw new Error("no image");
  } catch {
    return { error: "Upload a valid image. The file you uploaded was either not an image or a corrupted image." };
  }
  return { file: f };
}

/** django.utils.text.get_valid_filename */
function validFilename(name: string): string | null {
  const base = name.split(/[/\\]/).pop() ?? name;
  const s = base.trim().replace(/ /g, "_").replace(/[^-\p{L}\p{N}_.]/gu, "");
  return !s || s === "." || s === ".." ? null : s;
}

const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const randomSuffix = () => Array.from({ length: 7 }, () => CHARS[randomInt(CHARS.length)]).join("");

/** Save under MEDIA_ROOT/avatars/, returning the stored name (avatars/x.png). */
export async function storeAvatar(f: UploadedFile): Promise<string> {
  const name = validFilename(f.filename);
  if (!name) throw ApiError.badRequest("avatar", "Could not derive file name from the upload.");
  const dir = path.join(config.mediaRoot, "avatars");
  await mkdir(dir, { recursive: true });
  const dot = name.lastIndexOf(".");
  const [root, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  let candidate = name;
  for (;;) {
    try {
      const fh = await open(path.join(dir, candidate), "wx");
      try {
        await fh.writeFile(f.bytes);
      } finally {
        await fh.close();
      }
      return `avatars/${candidate}`;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      candidate = `${root}_${randomSuffix()}${ext}`;
    }
  }
}
