import fs from "node:fs";
import path from "node:path";
import { test as teardown } from "@playwright/test";
import { SHOTS_DIR } from "./env";
import { docsManifest, fileReader, serializeDocsManifest } from "./files";
import { SHOTS } from "./manifest";

/**
 * Runs after the screens, also when some failed: rewrites manifest.json from screens/manifest.ts and
 * the files on disk, so it lists exactly the shots that have a light and a dark file. The docs check
 * (apps/docs/scripts/check-release-posts.mjs) reads it.
 */
teardown("write the docs manifest.json", () => {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const manifest = docsManifest(SHOTS, fileReader(SHOTS_DIR));
  fs.writeFileSync(path.join(SHOTS_DIR, "manifest.json"), serializeDocsManifest(manifest));
});
