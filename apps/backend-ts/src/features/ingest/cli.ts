// Ingest commands of src/cli.ts: `scan` runs scan.user inline (the parity
// diff and benchmarks; like librephotos-rs' scan_bench) and prints a
// SCAN_REPORT line; `strip-thumbnail-metadata` is manage.py's command.
import { client } from "../../lib/db";
import { config } from "../../lib/config";
import { exif } from "../../lib/exif";
import { stripThumbnailMetadata } from "./thumbnailMetadata";
import { scanUser } from "./scan";

export async function ingestCommand(cmd: string, args: string[]) {
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const names = args.filter((a) => !a.startsWith("--"));
  if (cmd === "strip-thumbnail-metadata") {
    const r = await stripThumbnailMetadata(config.mediaRoot, config.exiftool ?? "exiftool", flags.has("--dry-run"), (m) => console.log(m));
    console.log(JSON.stringify({ scanned: r.scanned, with_metadata: r.withMetadata.length, stripped: r.stripped, still: r.stillWithMetadata.length, errors: r.errors }));
    return;
  }
  const users: { id: number; username: string }[] = names.length
    ? await client`SELECT id, username FROM api_user WHERE username = ANY(${`{${names.map((n) => JSON.stringify(n)).join(",")}}`}::text[]) ORDER BY id`
    : await client`SELECT id, username FROM api_user WHERE scan_directory <> '' ORDER BY id`;
  const total = performance.now();
  const report = [];
  for (const u of users) {
    const job = crypto.randomUUID();
    const t = performance.now();
    await scanUser(u.id, job, { fullScan: flags.has("--full"), skipFollowups: !flags.has("--followups") });
    const [j] = await client`SELECT progress_target, result FROM api_longrunningjob WHERE job_id = ${job}`;
    report.push({ user: u.username, groups: j?.progress_target ?? 0, seconds: (performance.now() - t) / 1000, result: j?.result ?? null });
  }
  const [{ n }] = await client`SELECT count(*)::int AS n FROM api_file`;
  const secs = (performance.now() - total) / 1000;
  console.log(`SCAN_REPORT ${JSON.stringify({ users: report, files: n, seconds: secs, files_per_second: n / secs, cpu_s: (process.resourceUsage().userCPUTime + process.resourceUsage().systemCPUTime) / 1e6, peak_rss_mib: Math.round(process.memoryUsage().rss / 2 ** 20) })}`);
  await exif.shutdown();
}
