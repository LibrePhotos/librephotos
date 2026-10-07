// In-process captions (port of lp_ml::caption::inprocess, i.e. the sidecar's
// service/image_captioning: POST /generate-caption {image_path, prompt?}).
//
// A missing model is MlUnavailable (like a sidecar that is not running);
// anything else, an unreadable image or a model that fails to load (e.g.
// the q4f16 `FastGelu` float16 kernel some CPU builds lack), is MlFailed 500
// like the sidecar's `{"error": ...}`. A model that fails to load is not
// kept (ModelSlot drops a failed load), so the next call tries again.
// Decoding and patching happen outside the slot, so the next photo prepares
// while the model runs.
import { existsSync } from "node:fs";
import path from "node:path";
import { MlFailed } from "../errors";
import { dataModels, modelSlot, MlUnavailable } from "../runtime";
import { DEFAULT_MAX_NEW_TOKENS, DEFAULT_PROMPT, Lfm2Vl, MODEL_FILES, MODEL_NAME, prepareFile, type Patches } from "./lfm2_vl";

const modelDir = () => path.join(dataModels(), MODEL_NAME);

/** `captioning_model_exists`: every file of the captioning model is on disk. */
export const captioningModelExists = () => MODEL_FILES.every((f) => existsSync(path.join(modelDir(), f)));

const slot = (dir: string) => modelSlot<Lfm2Vl>("caption", dir, () => Lfm2Vl.load(dir), (m) => m.release());

/** POST /generate-caption {image_path, prompt}: the cleaned caption. */
export async function generateCaption(imagePath: string, prompt?: string | null): Promise<string> {
  const dir = modelDir();
  if (!captioningModelExists()) throw new MlUnavailable(`the captioning model is not installed in ${dir}`);
  let patches: Patches;
  try {
    patches = await prepareFile(imagePath);
  } catch (e) {
    throw new MlFailed(500, `${imagePath}: ${(e as Error).message}`);
  }
  try {
    const g = await slot(dir).run((m) => m.generatePatches(patches, prompt || DEFAULT_PROMPT, DEFAULT_MAX_NEW_TOKENS));
    return g.caption;
  } catch (e) {
    if (e instanceof MlUnavailable) throw e;
    throw new MlFailed(500, (e as Error).message);
  }
}
