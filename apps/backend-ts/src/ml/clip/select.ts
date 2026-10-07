// Which models semantic search runs on now (port of lp_ml's
// `MlView::{semantic_model, semantic_shares_tagger}`): the site setting
// SEMANTIC_SEARCH_MODEL, except that MobileCLIP-S2 needs in-process CLIP
// (the Python sidecar only has ViT-B/32), and whether one MobileCLIP image
// run per photo yields both the tags and the stored search embedding.
import { siteSettings } from "../../lib/settings";
import { modeFor } from "../runtime";
import { IMPLEMENTED as SIMILARITY_IMPLEMENTED } from "../similarity/inprocess";
import { IMPLEMENTED as TAGS_IMPLEMENTED } from "../tags/inprocess";
import { DEFAULT_TAGGING_MODEL } from "../tags/tagger";
import { IMPLEMENTED as CLIP_IMPLEMENTED } from "./inprocess";
import { semanticOf, type SemanticModel } from "./model";

export const clipInProcess = () => modeFor("clip", CLIP_IMPLEMENTED) === "inprocess";
export const tagsInProcess = () => modeFor("tags", TAGS_IMPLEMENTED) === "inprocess";
export const similarityInProcess = () => modeFor("similarity", SIMILARITY_IMPLEMENTED) === "inprocess";

/** The semantic-search model in effect: the setting's, ViT-B/32 when MobileCLIP would need the (ViT-only) sidecar. */
export function semanticModelOf(setting: string | null | undefined): SemanticModel {
  const selected = semanticOf(setting);
  return selected === "mobileclip_s2" && !clipInProcess() ? "clip_vit_b32" : selected;
}

export async function semanticModel(): Promise<SemanticModel> {
  // Without in-process CLIP every setting means ViT-B/32: no settings read.
  if (!clipInProcess()) return "clip_vit_b32";
  return semanticModelOf((await siteSettings()).SEMANTIC_SEARCH_MODEL);
}

/**
 * Semantic search runs on the tagging model: MobileCLIP-S2 is both the
 * semantic-search and the tagging model and tags run in-process, so
 * tags.generate stores the search embedding from the tagger's run and
 * clip.embed reuses the tagger's image tower.
 */
export async function semanticSharesTagger(): Promise<boolean> {
  if (!clipInProcess() || !tagsInProcess()) return false;
  const s = await siteSettings();
  const semantic = semanticModelOf(s.SEMANTIC_SEARCH_MODEL);
  const tagging = s.TAGGING_MODEL.trim() || DEFAULT_TAGGING_MODEL;
  return semantic === "mobileclip_s2" && tagging === semantic && tagsInProcess();
}
