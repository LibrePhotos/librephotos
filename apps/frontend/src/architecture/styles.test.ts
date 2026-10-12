// The styling rules (AGENTS.md, Styling) as a ratchet. Per source file it counts what the rules
// retire: colour literals, `!important`, a component stylesheet imported as global CSS, and inline
// `style={{`. stylesBaseline.json holds the count each file had when the rules came in; a file may
// not go above its count, and a file that is not listed may have none. The baseline only shrinks:
// when a count goes down the test fails until the baseline is lowered in the same change, which
//
//   UPDATE_STYLES_BASELINE=1 yarn test src/architecture/styles.test.ts
//
// does. It lowers counts and drops files at zero; it never raises a count or adds a file.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const METRICS = ["colours", "important", "globalCss", "inlineStyles"] as const;
type Metric = (typeof METRICS)[number];
type Counts = Partial<Record<Metric, number>>;
type CountsByFile = Record<string, Counts>;

// The named homes for colours that are deliberate but not theme colours: chart palettes, the brand
// gradients, and the scrims and shadows drawn on photos (CSS variables, loaded from src/index.tsx).
const COLOUR_HOMES = new Set(["src/theme/chartColors.ts", "src/theme/brandGradients.ts", "src/theme/scrims.css"]);

const HEX = /(?<![\w&.#])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const COLOUR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/g;
const IMPORTANT = /!\s*important\b/g;
const INLINE_STYLE = /\bstyle=\{\{/g;
// A side-effect or default import of a relative stylesheet. CSS modules do not count, and neither
// does theme setup: package stylesheets (Mantine, maplibre) and the scrim variables.
const RELATIVE_CSS_IMPORT = /\bimport\s+(?:\w+\s+from\s+)?["']\.{1,2}\/[^"']*\.css["']/g;
const NOT_GLOBAL = /(?:\.module\.css|\/theme\/scrims\.css)["']$/;

/** Source without comments: CSS block comments; TS comment lines and trailing `// ...`. */
function stripComments(path: string, source: string): string {
  if (path.endsWith(".css")) return source.replace(/\/\*[\s\S]*?\*\//g, "");
  return source
    .split("\n")
    .filter(line => !/^\s*(?:\/\/|\/\*|\*|\{\/\*)/.test(line))
    .map(line => line.replace(/\s\/\/\s.*$/, ""))
    .join("\n");
}

const countOf = (code: string, pattern: RegExp) => code.match(pattern)?.length ?? 0;

function measure(path: string, source: string): Counts {
  const code = stripComments(path, source);
  const counts: Counts = {};
  const colours = COLOUR_HOMES.has(path) ? 0 : countOf(code, HEX) + countOf(code, COLOUR_FUNCTION);
  const important = countOf(code, IMPORTANT);
  const globalCss = (code.match(RELATIVE_CSS_IMPORT) ?? []).filter(match => !NOT_GLOBAL.test(match)).length;
  const inlineStyles = countOf(code, INLINE_STYLE);
  if (colours) counts.colours = colours;
  if (important) counts.important = important;
  if (globalCss) counts.globalCss = globalCss;
  if (inlineStyles) counts.inlineStyles = inlineStyles;
  return counts;
}

function measureAll(sources: Record<string, string>): CountsByFile {
  const counted: CountsByFile = {};
  for (const [path, source] of Object.entries(sources)) {
    const counts = measure(path, source);
    if (Object.keys(counts).length > 0) counted[path] = counts;
  }
  return counted;
}

/** The files above their baseline (`over`), and the baseline counts above the files (`stale`). */
function compare(actual: CountsByFile, baseline: CountsByFile): { over: string[]; stale: string[] } {
  const over: string[] = [];
  const stale: string[] = [];
  for (const file of [...new Set([...Object.keys(actual), ...Object.keys(baseline)])].sort()) {
    for (const metric of METRICS) {
      const now = actual[file]?.[metric] ?? 0;
      const allowed = baseline[file]?.[metric] ?? 0;
      if (now > allowed) over.push(`${file}: ${metric} ${now} (baseline ${allowed})`);
      if (now < allowed) stale.push(`${file}: ${metric} ${now} (baseline ${allowed})`);
    }
  }
  return { over, stale };
}

/** The baseline lowered to the actual counts: never raised, no new files, files at zero dropped. */
function lowered(actual: CountsByFile, baseline: CountsByFile): CountsByFile {
  const result: CountsByFile = {};
  for (const [file, allowed] of Object.entries(baseline)) {
    const counts: Counts = {};
    for (const metric of METRICS) {
      const count = Math.min(allowed[metric] ?? 0, actual[file]?.[metric] ?? 0);
      if (count > 0) counts[metric] = count;
    }
    if (Object.keys(counts).length > 0) result[file] = counts;
  }
  return result;
}

/** One line per file, sorted: a shape Prettier leaves as it is. */
function serialise(baseline: CountsByFile): string {
  const lines = Object.keys(baseline)
    .sort()
    .map(file => {
      const counts = METRICS.flatMap(metric => {
        const count = baseline[file]?.[metric];
        return count ? [`"${metric}": ${count}`] : [];
      });
      return `  ${JSON.stringify(file)}: { ${counts.join(", ")} }`;
    });
  return `{\n${lines.join(",\n")}\n}\n`;
}

const count = z.number().int().positive().optional();
const baselineSchema = z.record(
  z.string(),
  z.strictObject({ colours: count, important: count, globalCss: count, inlineStyles: count })
);

// `yarn test` runs from apps/frontend.
const BASELINE_PATH = resolve("src/architecture/stylesBaseline.json");
const baseline = baselineSchema.parse(JSON.parse(readFileSync(BASELINE_PATH, "utf8")));

const globbed = import.meta.glob<string>(
  [
    "/src/**/*.{ts,tsx,css}",
    "!/src/**/*.test.{ts,tsx}",
    "!/src/**/*.test-utils.{ts,tsx}",
    "!/src/__repro__/**",
    "!/src/setupTests.ts",
    "!/src/routeTree.gen.ts",
  ],
  { query: "?raw", import: "default", eager: true }
);
// Keys as the baseline writes them: "src/components/...".
const actual = measureAll(Object.fromEntries(Object.entries(globbed).map(([path, source]) => [path.slice(1), source])));

describe("styling ratchet (stylesBaseline.json)", () => {
  it("no file has more colour literals, !important, global stylesheets or inline styles than its baseline", () => {
    const { over } = compare(actual, baseline);
    expect(
      over,
      "Use theme colours (c, bg, var(--mantine-color-*), light-dark()), a CSS module and :hover, or Mantine style props; see AGENTS.md, Styling"
    ).toEqual([]);
  });

  it("the baseline is as low as the code", () => {
    if (process.env.UPDATE_STYLES_BASELINE) {
      writeFileSync(BASELINE_PATH, serialise(lowered(actual, baseline)));
      return;
    }
    const { stale } = compare(actual, baseline);
    expect(stale, "Lower the baseline: UPDATE_STYLES_BASELINE=1 yarn test src/architecture/styles.test.ts").toEqual([]);
  });
});

describe("the style counts", () => {
  const planted = (path: string, source: string) => compare(measureAll({ [path]: source }), {}).over;

  it("flag a colour literal in a component", () => {
    expect(planted("src/components/Foo.tsx", `const style = { color: "#ff0000" };`)).toEqual([
      "src/components/Foo.tsx: colours 1 (baseline 0)",
    ]);
    expect(planted("src/components/Foo.tsx", "const shadow = `0 1px 2px rgba(0, 0, 0, 0.2)`;")).toHaveLength(1);
  });

  it("flag !important in a CSS module", () => {
    expect(planted("src/components/Foo.module.css", ".title {\n  font-size: 18px !important;\n}\n")).toEqual([
      "src/components/Foo.module.css: important 1 (baseline 0)",
    ]);
  });

  it("flag a component stylesheet imported as global CSS, not a CSS module or a package stylesheet", () => {
    expect(planted("src/components/Foo.tsx", `import "./Foo.css";`)).toEqual([
      "src/components/Foo.tsx: globalCss 1 (baseline 0)",
    ]);
    expect(
      planted("src/components/Foo.tsx", `import classes from "./Foo.module.css";\nimport "@mantine/core/styles.css";`)
    ).toEqual([]);
    expect(planted("src/index.tsx", `import "./theme/scrims.css";`)).toEqual([]);
  });

  it("flag an inline style object", () => {
    expect(planted("src/components/Foo.tsx", `<Box style={{ marginTop: 8 }} />`)).toEqual([
      "src/components/Foo.tsx: inlineStyles 1 (baseline 0)",
    ]);
  });

  it("skip comments, issue numbers, theme variables and the colour homes", () => {
    const source = [
      "// was #ff0000, see #2359",
      "/* rgba(0, 0, 0, 0.5) */",
      `const fill = "var(--mantine-color-blue-6)"; // not #fff`,
      `const link = "https://example.com/#top";`,
    ].join("\n");
    expect(planted("src/components/Foo.tsx", source)).toEqual([]);
    expect(
      planted("src/components/Foo.module.css", "/* #fff */\n.a {\n  color: var(--mantine-color-white);\n}\n")
    ).toEqual([]);
    expect(planted("src/theme/chartColors.ts", `export const PALETTE = ["#ff0000"];`)).toEqual([]);
    expect(planted("src/theme/scrims.css", ":root {\n  --app-scrim-black-20: rgba(0, 0, 0, 0.2);\n}\n")).toEqual([]);
  });

  it("report a count that went down as stale, and lowering never raises or adds a file", () => {
    const now = { "src/a.tsx": { colours: 1 }, "src/new.tsx": { inlineStyles: 1 } };
    const before = { "src/a.tsx": { colours: 3, inlineStyles: 2 }, "src/gone.tsx": { colours: 1 } };
    expect(compare(now, before).stale).toEqual([
      "src/a.tsx: colours 1 (baseline 3)",
      "src/a.tsx: inlineStyles 0 (baseline 2)",
      "src/gone.tsx: colours 0 (baseline 1)",
    ]);
    expect(lowered(now, before)).toEqual({ "src/a.tsx": { colours: 1 } });
  });
});
