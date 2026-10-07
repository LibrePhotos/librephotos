// In-process tagging (port of lp_ml::tags::inprocess, i.e. the sidecar's
// service/tags/{main,mobileclip,siglip2}.py). One slot per tagging model
// holds the image tower and the tag embeddings; the text embeddings come
// from `<model dir>/tag_embeddings.npy`, built on first use when missing.
// Decoding and resizing happen outside the slot, so the next photos prepare
// while the model runs.
import { existsSync } from "node:fs";
import path from "node:path";
import { MlFailed } from "../errors";
import { dataModels, modelSlot, MlUnavailable } from "../runtime";
import { DEFAULT_TAGGING_MODEL, MAX_TAGS, prepareImage, Tagger, taggingModelFromName, threshold, type Prediction, type TaggingModel } from "./tagger";

/** Set once the port passes its goldens; `auto` mode then uses it. */
export const IMPLEMENTED = true;

/** `tagging_model or DEFAULT_TAGGING_MODEL` (only an empty name is the default). */
const modelName = (taggingModel: string) => (taggingModel === "" ? DEFAULT_TAGGING_MODEL : taggingModel);

function slotFor(taggingModel: string) {
  const name = modelName(taggingModel);
  const model = taggingModelFromName(name);
  if (!model) throw new MlFailed(400, `Unknown tagging model '${name}'`);
  const dir = path.join(dataModels(), name);
  if (!existsSync(path.join(dir, "vision_model.onnx"))) throw new MlUnavailable(`the ${name} model is not downloaded`);
  return { model, slot: modelSlot<Tagger>("tags", name, () => Tagger.load(model, dir), (t) => t.release()) };
}

async function predict(imagePath: string, taggingModel: string): Promise<Prediction> {
  const { model, slot } = slotFor(taggingModel);
  let prepared: { size: number; pixels: Float32Array };
  try {
    prepared = await prepareImage(model as TaggingModel, imagePath);
  } catch (e) {
    const err = new MlFailed(500, `Failed to process image: ${(e as Error).message}`);
    console.warn(`tags: error processing image ${imagePath}: ${err.message}`);
    throw err;
  }
  try {
    return await slot.run((t) => t.predictPixels(prepared.size, prepared.pixels, threshold(model), MAX_TAGS));
  } catch (e) {
    if (e instanceof MlUnavailable) throw e;
    const err = new MlFailed(500, `Failed to process image: ${(e as Error).message}`);
    console.warn(`tags: error processing image ${imagePath}: ${err.message}`);
    throw err;
  }
}

/** POST /generate-tags {image_path, confidence, tagging_model} -> {"tags": {"tags": [...]}}, plus the raw image embedding of the run. */
export async function generateTagsWithEmbedding(imagePath: string, taggingModel: string): Promise<{ reply: { tags: { tags: string[] } }; raw: Float32Array }> {
  const p = await predict(imagePath, taggingModel);
  return { reply: { tags: { tags: p.tags } }, raw: p.raw };
}

/** The raw image embedding of the tagging model's image tower, without tags. */
export async function imageEmbedding(imagePath: string, taggingModel: string): Promise<Float32Array> {
  return (await predict(imagePath, taggingModel)).raw;
}
