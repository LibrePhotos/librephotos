// bun run pack: a portable deploy folder, dist/pack/, after `bun run build`.
//
//   server.js (+ .jsc bytecode)   the server with every JS dependency bundled
//   cli.js                        adopt / scan / run-job ...
//   *-worker.js                   the worker threads (hash, face cluster, OCR crops, ORT)
//   migrations/                   for cli.js adopt
//   node_modules/                 only the native packages (sharp, onnxruntime-node,
//                                 exiftool-vendored) for this platform
//
// Run with: cd dist/pack && bun cli.js adopt && bun server.js (env as usual).
// Bun itself (bun.exe) is the only other file needed; ffmpeg for videos and
// Python for HEIC/JPEG XL/RAW fallbacks stay external, as for librephotos-rs.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const APP = path.join(import.meta.dir, "..");
const OUT = path.join(APP, "dist", "pack");
const NATIVE = ["sharp", "onnxruntime-node", "exiftool-vendored"];

if (!existsSync(path.join(APP, "dist", "server", "server.js"))) throw new Error("run `bun run build` first");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

async function build(entry: string, name: string, opts: { bytecode?: boolean } = {}) {
  const r = await Bun.build({
    entrypoints: [path.join(APP, entry)],
    target: "bun",
    format: opts.bytecode ? "cjs" : "esm",
    bytecode: opts.bytecode ?? false,
    minify: true,
    external: NATIVE,
    outdir: OUT,
    naming: name,
  });
  if (!r.success) throw new AggregateError(r.logs, `build of ${entry} failed`);
}

await build("server.ts", "server.js", { bytecode: true });
await build("src/cli.ts", "cli.js");
await build("src/features/ingest/hashWorker.ts", "hash-worker.js");
await build("src/ml/face_cluster/worker.ts", "face-cluster-worker.js");
await build("src/ml/ocr/cropWorker.ts", "ocr-crop-worker.js");
await build("src/ml/ortWorker.ts", "ort-worker.js");
cpSync(path.join(APP, "migrations"), path.join(OUT, "migrations"), { recursive: true });

// The native packages at the versions the app was built with.
const pkg = await Bun.file(path.join(APP, "package.json")).json();
const deps = Object.fromEntries(NATIVE.map((n) => [n, pkg.dependencies[n]]));
writeFileSync(path.join(OUT, "package.json"), JSON.stringify({ name: "librephotos-ts-pack", private: true, dependencies: deps }, null, 2));
const inst = Bun.spawnSync([process.execPath, "install", "--production"], { cwd: OUT, stdout: "inherit", stderr: "inherit" });
if (inst.exitCode !== 0) throw new Error("bun install failed");

// onnxruntime-node carries binaries for every OS (~290 MB): keep ours.
const ortBin = path.join(OUT, "node_modules", "onnxruntime-node", "bin", "napi-v6");
for (const os of readdirSync(ortBin)) {
  for (const arch of readdirSync(path.join(ortBin, os))) {
    if (os !== process.platform || arch !== process.arch) rmSync(path.join(ortBin, os, arch), { recursive: true, force: true });
  }
}
// ExifTool: the Windows build (exiftool-vendored.exe) or the Perl one, not both.
const other = path.join(OUT, "node_modules", process.platform === "win32" ? "exiftool-vendored.pl" : "exiftool-vendored.exe");
rmSync(other, { recursive: true, force: true });

function du(p: string): number {
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p).reduce((s, e) => s + du(path.join(p, e)), 0);
}
const mib = (b: number) => `${(b / 2 ** 20).toFixed(1)} MiB`;
console.log(`dist/pack: ${mib(du(OUT))} (node_modules ${mib(du(path.join(OUT, "node_modules")))}, ` +
  `server.js+jsc ${mib(du(path.join(OUT, "server.js")) + (existsSync(path.join(OUT, "server.js.jsc")) ? du(path.join(OUT, "server.js.jsc")) : 0))}); ` +
  `plus bun ${mib(statSync(process.execPath).size)}`);
for (const e of readdirSync(path.join(OUT, "node_modules")).sort()) {
  const s = du(path.join(OUT, "node_modules", e));
  if (s > 1024 * 1024) console.log(`  node_modules/${e}: ${mib(s)}`);
}
