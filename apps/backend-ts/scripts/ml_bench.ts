// Per-photo latency and resident memory of the in-process tagger and CLIP
// towers on a directory of big thumbnails (what tags.generate / clip.embed
// feed them); counterpart of lp-ml's bench_tagger_latency_and_memory.
//
//   ONNX_INTRA_OP_THREADS=4 bun run scripts/ml_bench.ts <thumbnails dir> [limit]
//
// LP_DATA_MODELS as for scripts/ml_goldens.ts. Keep runs short (< 10 min).
import { readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../../..");
process.env.LP_DATA_MODELS ??= path.join(ROOT, "rust-pg", "ml", "protected_media", "data_models");
process.env.LP_ML_IDLE_UNLOAD_SECS ??= "0";
const dir = process.argv[2] ?? path.join(ROOT, "rust-pg", "fixture", "protected_media", "thumbnails_big");
const limit = Number(process.argv[3] ?? 1000);
const imgs = readdirSync(dir)
  .filter((f) => f.endsWith(".webp"))
  .sort()
  .slice(0, limit)
  .map((f) => path.join(dir, f));

const tags = await import("../src/ml/tags/inprocess");
const clip = await import("../src/ml/clip/inprocess");
const { loadedModels } = await import("../src/ml/runtime");
const mb = () => (process.memoryUsage().rss / 1e6).toFixed(0);
const ms = (t: number) => (performance.now() - t).toFixed(0);

console.log(`${imgs.length} images; RSS at start ${mb()} MB`);
let t = performance.now();
await tags.generateTagsWithEmbedding(imgs[0], "mobileclip_s2");
console.log(`mobileclip_s2 tagger: load + first photo ${ms(t)} ms, RSS ${mb()} MB (${loadedModels().join(", ")})`);

t = performance.now();
for (const p of imgs) await tags.generateTagsWithEmbedding(p, "mobileclip_s2");
console.log(`  sequential: ${((performance.now() - t) / imgs.length).toFixed(1)} ms/photo`);
t = performance.now();
let next = 0;
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (next < imgs.length) await tags.generateTagsWithEmbedding(imgs[next++], "mobileclip_s2");
  }),
);
console.log(`  4 in flight (the tags job): ${((performance.now() - t) / imgs.length).toFixed(1)} ms/photo, RSS ${mb()} MB`);

const vit = path.join(process.env.LP_DATA_MODELS!, "clip_vit_b32");
t = performance.now();
await clip.imageEmbeddings(imgs.slice(0, 1), vit);
console.log(`clip_vit_b32 (both towers): load + first photo ${ms(t)} ms, RSS ${mb()} MB`);
t = performance.now();
await clip.imageEmbeddings(imgs, vit);
console.log(`  one clip.embed batch call: ${((performance.now() - t) / imgs.length).toFixed(1)} ms/photo, RSS ${mb()} MB`);
t = performance.now();
for (const q of ["dog", "sunset at the beach", "people at a birthday party"]) await clip.queryEmbedding(q, vit);
console.log(`  text query: ${((performance.now() - t) / 3).toFixed(1)} ms`);
process.exit(0);
