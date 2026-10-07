// AddFaceView (POST /api/addface; port of lp_api::people_faces::add_face): a
// face box drawn by hand becomes a labelled face. The box arrives as fractions
// of the displayed image and is stored in big-thumbnail pixels; the crop is cut
// from the big thumbnail.
import { loadSharp } from "~/lib/native";
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "~/lib/config";
import { ApiError } from "~/lib/errors";
import { json, jsonBody } from "~/lib/http";
import { pyTruthy } from "~/lib/query";
import { siteSettings } from "~/lib/settings";
import { faceEncodingsInProcess, faceMode } from "~/ml/face/index";
import type { User } from "~/lib/users";
import { UNKNOWN_PERSON_NAME, mediaUrl, parsePyFloat, statusMessage, strippedStr } from "./common";
import * as dbq from "./db";
import { queueFaceTags } from "./faces";
import * as write from "./write";

/** A box smaller than this in big-thumbnail pixels is a stray drag. */
const MIN_SIDE_PIXELS = 12;
/** api.util.FACE_OVERLAP_IOU_THRESHOLD */
const FACE_OVERLAP_IOU_THRESHOLD = 0.3;

const bad = (message: string) => statusMessage(400, message);

/** Python float(v) of a JSON value. */
function pyFloat(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") return parsePyFloat(v);
  return null;
}

/** Python round(): half to even. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x - Math.trunc(x)) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

type Box = [number, number, number, number];

/** AddFaceView._box_in_pixels: (top, right, bottom, left) or the message. */
function boxInPixels(b: unknown, width: number, height: number): Box | string {
  if (!b || typeof b !== "object" || Array.isArray(b)) return "box is required, with top, right, bottom and left";
  const sides: number[] = [];
  for (const side of ["top", "right", "bottom", "left"]) {
    const v = pyFloat((b as Record<string, unknown>)[side]);
    if (v === null) return `box.${side} must be a number between 0 and 1`;
    if (!(v >= 0 && v <= 1)) return `box.${side} must be between 0 and 1`;
    sides.push(v);
  }
  const [t, r, bo, l] = sides;
  if (r <= l || bo <= t) return "box must have a positive width and height";
  const top = Math.max(0, Math.min(roundHalfEven(t * height), height - 1));
  const left = Math.max(0, Math.min(roundHalfEven(l * width), width - 1));
  const bottom = Math.max(top + 1, Math.min(roundHalfEven(bo * height), height));
  const right = Math.max(left + 1, Math.min(roundHalfEven(r * width), width));
  if (right - left < MIN_SIDE_PIXELS || bottom - top < MIN_SIDE_PIXELS)
    return `the box is too small; each side has to be at least ${MIN_SIDE_PIXELS} pixels of the photo's big thumbnail`;
  return [top, right, bottom, left];
}

/** api.util.calculate_iou on (top, right, bottom, left) boxes. */
function iou(a: Box, b: Box): number {
  const interW = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[3], b[3]));
  const interH = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const inter = interW * interH;
  const area = (x: Box) => (x[2] - x[0]) * (x[1] - x[3]);
  const union = area(a) + area(b) - inter;
  return union <= 0 ? 0 : inter / union;
}

const mediaPath = (name: string) => path.join(config.mediaRoot, ...name.split(/[/\\]/).filter(Boolean));

/** FaceEncoding hex (little-endian f64s). */
function encodeEncoding(values: number[]): string {
  const buf = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => buf.writeDoubleLE(v, i * 8));
  return buf.toString("hex");
}

/**
 * The face service's encoding of one box, or null when the service is down,
 * errors or detects no face there (Django then keeps the face without one).
 * In process (LP_ML_FACE) the same contract runs on the local models.
 */
async function faceEncoding(imagePath: string, box: Box, model: string): Promise<number[] | null> {
  try {
    if (faceMode() === "inprocess") return (await faceEncodingsInProcess(imagePath, [box], model))[0] ?? null;
    const res = await fetch(`${config.sidecar("face", 8005)}/face-encodings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: imagePath, face_locations: [box], model_name: model }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`face service answered ${res.status}`);
    const body = (await res.json()) as { encodings?: (number[] | null)[] };
    return body.encodings?.[0] ?? null;
  } catch (e) {
    console.warn("face service failed; face kept without encoding:", (e as Error).message);
    return null;
  }
}

/** POST /api/addface {photo, person_name, box: {top, right, bottom, left}} */
export async function addFace(user: User, request: Request) {
  const body = await jsonBody<unknown>(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw ApiError.internal("addface body is not an object");
  const personName = strippedStr(body, "person_name");
  if (!personName) return bad("person_name must not be empty");
  if (personName === UNKNOWN_PERSON_NAME)
    return bad(`a face drawn by hand has to name someone; '${UNKNOWN_PERSON_NAME}' is what the algorithms use`);
  const raw = (body as Record<string, unknown>).photo;
  if (!pyTruthy(raw)) return bad("photo is required");
  const photoRef = typeof raw === "string" ? raw : JSON.stringify(raw);
  const photo = await dbq.addFacePhoto(user.id, photoRef);
  if (!photo) return statusMessage(404, "photo not found");
  if (!photo.thumbnail_big) return bad("this photo has no big thumbnail yet, so there is nothing to measure the box against");
  const thumb = mediaPath(photo.thumbnail_big);
  let size: { width: number; height: number } | null = null;
  try {
    const m = await (await loadSharp())(thumb).metadata();
    if (m.width && m.height) size = { width: m.width, height: m.height };
  } catch {
    size = null;
  }
  if (!size) {
    console.error(`cannot open thumbnail ${thumb}`);
    return bad("this photo's thumbnail cannot be read");
  }
  const bx = boxInPixels((body as Record<string, unknown>).box, size.width, size.height);
  if (typeof bx === "string") return bad(bx);
  if (photo.boxes.some((e) => e.length === 4 && iou(bx, e as Box) >= FACE_OVERLAP_IOU_THRESHOLD))
    return statusMessage(409, "there is already a face here; label that one instead of adding a second face over it");

  const [top, right, bottom, left] = bx;
  const jpeg = await (await loadSharp())(thumb)
    .extract({ left, top, width: right - left, height: bottom - top })
    .removeAlpha()
    .jpeg({ quality: 75 })
    .toBuffer();
  const facesDir = path.join(config.mediaRoot, "faces");
  await mkdir(facesDir, { recursive: true });
  const fileName = `${photo.image_hash}_manual_${randomUUID().replace(/-/g, "").slice(0, 8)}.jpg`;
  const filePath = path.join(facesDir, fileName);
  await writeFile(filePath, jpeg);

  const settings = await siteSettings();
  const enc = await faceEncoding(thumb, bx, settings.FACE_RECOGNITION_MODEL);
  const image = `faces/${fileName}`;
  let created: { faceId: number; personId: number };
  try {
    created = await write.addManualFace(
      user.id,
      personName,
      { photoId: photo.id, image, top, right, bottom, left, encoding: enc ? encodeEncoding(enc) : "" },
      settings.TAGGING_MODEL,
    );
  } catch (e) {
    await unlink(filePath).catch(() => {});
    throw e;
  }
  await queueFaceTags(user, [photo.id]);
  return json(
    {
      status: true,
      face: {
        face_id: created.faceId,
        face_url: mediaUrl(image),
        person: created.personId,
        person_name: personName,
        location: { top, right, bottom, left },
      },
    },
    201,
  );
}
