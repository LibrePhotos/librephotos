import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where the shots and manifest.json go: the docs site, unless SHOTS_DIR points elsewhere. */
export const SHOTS_DIR = process.env.SHOTS_DIR
  ? path.resolve(process.env.SHOTS_DIR)
  : fileURLToPath(new URL("../../../docs/static/img/shots/", import.meta.url));

/** Comma-separated shot ids to take (screens/manifest.ts); empty takes every shot. */
export const SHOTS_FILTER = process.env.SHOTS;

/**
 * The day the browser clock and the Memories strip are fixed to, so two runs show the same
 * memories. The default has "On this day" photos in the e2e sample library (May 12, 2024).
 */
export const SHOTS_DAY = process.env.SHOTS_DAY ?? "2026-05-12";
