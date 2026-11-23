// Compare two walk.mjs reports and list what happens on the backend under test
// but not on the reference, step by step.
//
//   node diff.mjs <reference report.json> <actual report.json> [out.json]
import fs from "node:fs";

const [refPath, actPath, outPath] = process.argv.slice(2);
if (!refPath || !actPath) {
  console.error("usage: node diff.mjs <reference report.json> <actual report.json> [out.json]");
  process.exit(2);
}
const load = p => JSON.parse(fs.readFileSync(p, "utf8"));
const ref = load(refPath);
const act = load(actPath);

// Strip what differs between two dev servers but says nothing about the backend:
// origins, Vite's dependency hashes, React's component stacks.
const normText = s =>
  String(s)
    .split("\n")[0]
    .replace(/https?:\/\/[^/\s)]+/g, "")
    .replace(/\?v=[0-9a-f]+/g, "")
    .trim();
const request = r => `${r.method} ${r.path} -> ${r.status ?? r.error}`;

const kinds = {
  failed: s => s.failed.map(request),
  requestFailed: s => s.requestFailed.map(request),
  consoleErrors: s => s.consoleErrors.map(normText),
  pageErrors: s => s.pageErrors.map(normText),
  notifications: s => s.notifications.map(normText),
  brokenImages: s => s.brokenImages ?? [],
  stepError: s => (s.stepError ? [normText(s.stepError)] : []),
  errorBoundary: s => (s.errorBoundary ? ["error boundary rendered"] : []),
  // Virtualised grids render a scroll-dependent subset, so only page loads count.
  tiles: s => (s.kind === "visit" ? [`${s.tiles} photo tiles`] : []),
  // Body text lines: the fixture is identical, so a line only one side renders
  // is a rendering difference (counts, titles, empty states).
  text: s => (s.text ?? "").split("\n").map(l => l.trim()).filter(Boolean),
};

// Set difference: how often the frontend retries or refetches is timing, not backend behaviour.
function minus(a, b) {
  const seen = new Set(b);
  return a.filter(x => !seen.has(x));
}

const key = s => `${s.role} ${s.name}`;
const refSteps = new Map(ref.steps.map(s => [key(s), s]));
const result = [];
for (const s of act.steps) {
  const r = refSteps.get(key(s));
  if (!r) {
    result.push({ step: key(s), onlyInActual: true });
    continue;
  }
  const entry = { step: key(s), url: s.url, screenshot: s.screenshot, refScreenshot: r.screenshot, ms: s.ms, refMs: r.ms };
  let any = false;
  for (const [kind, get] of Object.entries(kinds)) {
    const extra = [...new Set(minus(get(s), get(r)))];
    const missing = [...new Set(minus(get(r), get(s)))];
    if (extra.length || (kind === "text" || kind === "tiles") && missing.length) {
      entry[kind] = { actualOnly: extra, referenceOnly: missing };
      any = true;
    }
  }
  if (any) result.push(entry);
}
for (const s of ref.steps) if (!act.steps.some(a => key(a) === key(s))) result.push({ step: key(s), onlyInReference: true });

for (const e of result) {
  console.log(`\n## ${e.step}${e.url ? `  (${e.url})` : ""}`);
  for (const [kind, v] of Object.entries(e)) {
    if (!v || typeof v !== "object") continue;
    if (v.actualOnly.length) console.log(`  ${kind} only on actual:\n    ${v.actualOnly.slice(0, 15).join("\n    ")}`);
    if (v.referenceOnly.length) console.log(`  ${kind} only on reference:\n    ${v.referenceOnly.slice(0, 15).join("\n    ")}`);
  }
}
console.log(`\n${result.length} step(s) differ out of ${act.steps.length}`);
if (outPath) fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
