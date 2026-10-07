// In-process OCR (port of lp_ml::ocr::inprocess, i.e. the sidecar's
// service/ocr). Contract: `POST /ocr {image_path, min_confidence=0.6,
// max_side?, det_only?}` -> {text, blocks, image_width, image_height,
// mean_confidence, text_area_fraction}; a missing or undecodable image is a
// 400. The Python sidecar always loads ppocrv6_small and ignores the
// OCR_MODEL site setting; the port (like librephotos-rs) uses the selected
// bundle. Decoding, resizing and the pixel work around the two model runs
// happen outside the model slot, so other photos' work overlaps inference.
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { MlFailed } from "../errors";
import { dataModels, modelSlot, MlUnavailable } from "../runtime";
import { BUNDLE_FILES, loadConfig, OCR_MODELS, type OcrConfig } from "./config";
import { DecodeError, readImage } from "./decode";
import { assemble, blockJson, boxesFromBitmap, defaultOptions, detInput, Engine, recBatches, type Options, type Prediction } from "./ppocr";
import { rotateCrop } from "./warp";

/** Set once the port passes its goldens; `auto` mode then uses it. */
export const IMPLEMENTED = true;

const notSelected = (v: string) => {
  const t = v.trim();
  return !t || t.toLowerCase() === "none";
};

/** The bundle directory of `model` when it is fully installed. */
export function installedBundle(model: string): string | null {
  const rel = OCR_MODELS[model];
  if (!rel) return null;
  const dir = path.join(dataModels(), rel);
  return BUNDLE_FILES.every((f) => existsSync(path.join(dir, f))) ? dir : null;
}

/** The selected bundle's directory, or why OCR cannot run. */
function bundle(model: string): string {
  if (notSelected(model)) throw new MlUnavailable("no OCR model selected");
  const rel = OCR_MODELS[model];
  if (!rel) throw new MlUnavailable(`unknown OCR model ${JSON.stringify(model)}`);
  const dir = installedBundle(model);
  if (!dir) throw new MlUnavailable(`OCR model ${model} is not installed (${path.join(dataModels(), rel)})`);
  return dir;
}

/**
 * `LP_OCR_PREPASS`: detection side of a cheap text check before full OCR. A
 * photo whose detection at this side finds no text box gets an empty result
 * without the full-size detection and the recognition. Unset or 0 = off.
 */
function prepassSide(): number | null {
  const n = Number.parseInt((process.env.LP_OCR_PREPASS ?? "").trim(), 10);
  return Number.isInteger(n) && n >= 64 ? n : null;
}

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The whole `/ocr` request (`min_confidence`, `max_side`, `det_only` as the sidecar takes them) with model `model`. */
export async function predict(imagePath: string, model: string, opts: Options = defaultOptions()): Promise<Prediction> {
  // A missing file is bad input, rejected before paying the model load.
  if (!isFile(imagePath)) throw new MlFailed(400, "Image not found");
  const dir = bundle(model);
  let img;
  try {
    img = await readImage(imagePath);
  } catch (e) {
    if (e instanceof DecodeError) {
      console.warn(`ocr: could not decode image ${imagePath}: ${e.message}`);
      throw new MlFailed(400, "Failed to decode image");
    }
    throw e;
  }
  const cfg = configFor(dir);
  const slot = modelSlot<Engine>("ocr", model, () => Engine.load(dir), (e) => e.release());
  // Only the two model runs hold the slot: resizing, the DB postprocess and
  // the crops of one photo overlap the inference of the others.
  const detect = async (side: number) => {
    const d = detInput(img, cfg, side);
    const [prob, pw, ph] = await slot.run((e) => e.runDet(d));
    return boxesFromBitmap(prob, pw, ph, cfg, [img.w, img.h]);
  };
  try {
    const prepass = prepassSide();
    // No text at the coarse size: an empty result.
    if (prepass !== null && !opts.detOnly && !(await detect(prepass)).length) return assemble(img, [], [], opts);
    const boxes = await detect(opts.maxSide ?? cfg.detMaxSide);
    if (opts.detOnly) return assemble(img, boxes, null, opts);
    const crops = boxes.map((q) => rotateCrop(img, q));
    const batches = recBatches(crops, cfg);
    const recognized = crops.length ? await slot.run((e) => e.runRec(batches, crops.length)) : [];
    return assemble(img, boxes, recognized, opts);
  } catch (e) {
    if (e instanceof MlUnavailable || e instanceof MlFailed) throw e;
    console.warn(`ocr failed for ${imagePath} (model ${model}): ${(e as Error).message}`);
    throw new MlFailed(500, (e as Error).message);
  }
}

const configs = new Map<string, OcrConfig>();
/** The bundle's config.json + charset, read once per directory. */
function configFor(dir: string): OcrConfig {
  let c = configs.get(dir);
  if (!c) configs.set(dir, (c = loadConfig(dir)));
  return c;
}

/** What the sidecar's /ocr answers with bundle `model` (the OCR_MODEL setting), for `ocr.generate`. */
export async function ocr(imagePath: string, model: string, minConfidence: number): Promise<OcrAnswer> {
  const p = await predict(imagePath, model, { ...defaultOptions(), minConfidence });
  return {
    text: p.text,
    blocks: p.blocks.map(blockJson),
    text_area_fraction: p.textAreaFraction,
    mean_confidence: p.meanConfidence,
    image_width: p.imageWidth,
    image_height: p.imageHeight,
  };
}

export interface OcrAnswer {
  text: string;
  blocks: ReturnType<typeof blockJson>[];
  text_area_fraction: number;
  mean_confidence: number;
  image_width: number;
  image_height: number;
}
