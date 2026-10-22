import manifest from "@site/static/img/shots/manifest.json";
import { findShot, type Shot } from "@site/src/data/shots";

const SHOTS: readonly Shot[] = manifest;

/** Alt text and size of a screenshot, from static/img/shots/manifest.json. Throws for an unknown id. */
export function shotInfo(id: string): Shot {
  return findShot(SHOTS, id);
}
