// The semantic-search models (port of lp_ml::clip::SemanticModel): the site
// setting SEMANTIC_SEARCH_MODEL, which model a stored embedding came from
// (api_photo.clip_embeddings_model, NULL = Django's ViT-B/32) and the
// inner-product cuts, which follow the model because the raw scales differ
// (ViT-B/32: image and text norms ~10; MobileCLIP-S2: image ~1, text ~9.5).

export type SemanticModel = "clip_vit_b32" | "mobileclip_s2";

export const DEFAULT_SEMANTIC_MODEL: SemanticModel = "mobileclip_s2";
/** The model of embeddings whose clip_embeddings_model is NULL (Django's only one). */
export const LEGACY_SEMANTIC_MODEL: SemanticModel = "clip_vit_b32";

/** The setting's model, null for an unknown value ("" is the default). */
export function semanticFromName(name: string): SemanticModel | null {
  const n = name.trim();
  if (n === "clip_vit_b32") return "clip_vit_b32";
  if (n === "" || n === "mobileclip_s2") return "mobileclip_s2";
  return null;
}

/** The setting's model, the default for an unknown value. */
export const semanticOf = (name: string | null | undefined): SemanticModel => semanticFromName(name ?? "") ?? DEFAULT_SEMANTIC_MODEL;

/** Which model a model directory passed as `model` holds. */
export function semanticOfDir(dir: string): SemanticModel {
  const base = dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return base === "mobileclip_s2" ? "mobileclip_s2" : "clip_vit_b32";
}

/** The model of a stored embedding (null column = ViT-B/32; an unknown name = none). */
export function storedModel(column: string | null): SemanticModel | null {
  if (column === null) return LEGACY_SEMANTIC_MODEL;
  return column === "clip_vit_b32" || column === "mobileclip_s2" ? column : null;
}

/** Whether an embedding stored with this clip_embeddings_model belongs in `model`'s index. */
export const producedBy = (model: SemanticModel, column: string | null) => storedModel(column) === model;

/**
 * Inner-product cut of a text search (search_similar_embedding's 27 for
 * ViT-B/32); MobileCLIP's keeps the same share of photos per query on the
 * bench corpus (ViT-B/32 at 27: 10.1 photos per query, MobileCLIP-S2 at 1.84: 10.2).
 */
export const searchThreshold = (m: SemanticModel) => (m === "clip_vit_b32" ? 27 : 1.84);

/** Inner-product cut of the photo detail's similar photos (90 for ViT-B/32; 0.71 gives the same count). */
export const similarThreshold = (m: SemanticModel) => (m === "clip_vit_b32" ? 90 : 0.71);
