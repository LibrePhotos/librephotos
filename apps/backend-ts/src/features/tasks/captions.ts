// `captions.generate` and the caption behind /api/photosedit/generateim2txt
// (PhotoCaption.generate_captions_im2txt); port of lp_tasks::captions over the
// in-process captioner (src/ml/caption) or the image_captioning sidecar.
import { client } from "../../lib/db";
import { config } from "../../lib/config";
import { siteSettings } from "../../lib/settings";
import { pyTruthy } from "../../lib/query";
import { loadPhoto, thumbnailPath } from "./photos";
import { rebuildSearchCaptions } from "./searchCaptions";
import * as sidecars from "./sidecars";
import { captionInProcess } from "../../ml/caption/select";
import type { Exec } from "./things";

export interface CaptionContext {
  personName: string | null;
  location: string | null;
  addKeywords: boolean;
}

/** PhotoCaption._caption_prompt. */
export function captionPrompt(ctx: CaptionContext | null): string {
  if (!ctx) return "Describe this image in a short, natural image caption.";
  const person = ctx.personName
    ? ` The person in the photo is named ${ctx.personName}. Use the name '${ctx.personName}' directly in the caption — do not say 'a person named'. Keep the caption casual and to the point, like a friend tagging a photo.`
    : "";
  const place = ctx.location ? ` This photo was taken at ${ctx.location}.` : "";
  const keywords = ctx.addKeywords ? " Include relevant tags and keywords." : "";
  return `Write a short, natural image caption.${person}${place}${keywords}`;
}

/** PhotoCaption._caption_context: what the owner's llm_settings allow (null when off). */
export async function captionContext(photoId: string, ownerId: number): Promise<CaptionContext | null> {
  const [{ llm_settings }] = await client`SELECT llm_settings FROM api_user WHERE id = ${ownerId}`;
  let s: any = llm_settings;
  if (typeof s === "string") {
    try {
      s = JSON.parse(s);
    } catch {
      s = null;
    }
  }
  const flag = (k: string) => !!s && typeof s === "object" && pyTruthy(s[k]);
  if (!flag("enabled")) return null;
  let personName: string | null = null;
  if (flag("add_person")) {
    const [r] = await client`SELECT pe.name FROM api_face f JOIN api_person pe ON pe.id = f.person_id WHERE f.photo_id = ${photoId} ORDER BY f.id LIMIT 1`;
    personName = r?.name ?? null;
  }
  let location: string | null = null;
  if (flag("add_location")) {
    const [r] = await client`SELECT search_location FROM api_photo_search WHERE photo_id = ${photoId}`;
    location = r?.search_location || null;
  }
  return { personName, location, addKeywords: flag("add_keywords") };
}

/** The sidecar's caption without its <start>/<end> markers. */
export const cleanCaption = (c: string) => c.replaceAll("<start>", "").replaceAll("<end>", "").trim();

/** get_or_create the caption row. */
export async function ensureCaptionRow(photoId: string): Promise<void> {
  await client`INSERT INTO api_photo_caption (photo_id, captions_json, created_at, updated_at) VALUES (${photoId}, NULL, now(), now())
    ON CONFLICT (photo_id) DO NOTHING`;
}

/** Store captions_json.im2txt and rebuild search captions, in one transaction. */
export async function storeGeneratedCaption(photoId: string, caption: string): Promise<void> {
  const model = (await siteSettings()).TAGGING_MODEL;
  await client.begin(async (txn) => {
    const tx = txn as unknown as Exec;
    await tx`UPDATE api_photo_caption SET captions_json = jsonb_set(
        CASE WHEN jsonb_typeof(captions_json) = 'object' THEN captions_json ELSE '{}'::jsonb END,
        '{im2txt}', to_jsonb(${caption}::text)), updated_at = now()
      WHERE photo_id = ${photoId}`;
    await rebuildSearchCaptions(tx, [photoId], model);
  });
}

/**
 * get_or_create the caption row, then caption the photo. A sidecar failure
 * is not an error (Django logs it and returns False): the result says why.
 */
export async function generateIm2txt(photoId: string): Promise<{ ok: true; caption: string } | { ok: false; reason: string }> {
  const photo = await loadPhoto(photoId);
  if (!photo) return { ok: false, reason: "photo not found" };
  await ensureCaptionRow(photoId);
  if (!config.features.imageCaptioning) return { ok: false, reason: "image captioning is disabled" };
  const thumb = thumbnailPath(photo);
  if (!thumb) return { ok: false, reason: "no thumbnail" };
  if ((await siteSettings()).CAPTIONING_MODEL.toLowerCase() === "none") return { ok: false, reason: "captioning is disabled" };
  const prompt = captionPrompt(await captionContext(photoId, photo.owner_id));
  let caption: string;
  try {
    const raw = captionInProcess()
      ? await (await import("../../ml/caption/inprocess")).generateCaption(thumb, prompt)
      : await sidecars.generateCaption(thumb, prompt);
    caption = cleanCaption(raw);
  } catch (e) {
    console.error(`could not generate caption for ${thumb}: ${(e as Error).message}`);
    return { ok: false, reason: "captioning sidecar failed" };
  }
  await storeGeneratedCaption(photoId, caption);
  return { ok: true, caption };
}
