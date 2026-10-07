// Worker-thread entry files. From source a worker is its own .ts file next
// to the module; the server bundle has no such file, so `bun run build` also
// builds each worker to dist/<name>.js and this finds it from the chunk's
// directory (dist/server/assets, dist/aot) or the app's cwd.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function workerFile(moduleUrl: string, sourceName: string, builtName: string): string | null {
  const here = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    path.join(here, sourceName),
    path.join(here, builtName),
    path.join(here, "..", builtName),
    path.join(here, "..", "..", builtName),
    path.join(process.cwd(), "dist", builtName),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}
