// @vitest-environment node
/**
 * Every key in the English file is used somewhere in the app. A key counts as used when a string in
 * a non-test source file names it: a t() argument, an i18nKey, or a value in a typed key map. A
 * template literal such as `stacks.typelabel.${type}` uses every key it can expand to. Plural forms
 * (`photos_one`, `photos_other`) count as their base key.
 *
 * Keys unused today are listed in src/locales/unusedKeysBaseline.txt. The list only shrinks: a newly
 * unused key fails, and so does a listed key that is used again or no longer exists. The type check
 * (src/@types/i18next.d.ts) covers the other direction, a key used in code but missing here.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import translationEn from "./locales/en/translation.json";

// `yarn test` runs from apps/frontend, which is where src/ is.
const SRC = resolve("src");
const BASELINE = join(SRC, "locales", "unusedKeysBaseline.txt");
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key));
}

/** The keys as code names them: plural forms folded into their base key. */
function baseKeys(translation: unknown): Set<string> {
  return new Set(flatten(translation).map(key => key.replace(PLURAL_SUFFIX, "")));
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type References = { literals: Set<string>; patterns: RegExp[] };

/** The strings in one source file: plain literals, and template literals as patterns. */
function collectReferences(fileName: string, source: string, into: References): void {
  // A .ts file parsed as TSX loses everything after its first `<T>` (a generic arrow, an old-style cast).
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind);
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      into.literals.add(node.text);
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map(span => span.literal.text)];
      // A pattern with no fixed text (`${a}${b}`) would match every key.
      if (parts.join("").length > 0) {
        into.patterns.push(new RegExp(`^${parts.map(escapeRegExp).join(".+")}$`));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

/** The base keys no reference names, sorted. */
function unusedKeys(keys: Set<string>, references: References): string[] {
  return [...keys]
    .filter(key => !references.literals.has(key) && !references.patterns.some(pattern => pattern.test(key)))
    .sort();
}

const isAppSource = (path: string) =>
  /\.(ts|tsx)$/.test(path) &&
  !/\.(test|test-utils)\.(ts|tsx)$/.test(path) &&
  !path.endsWith(".d.ts") &&
  !path.startsWith("locales/") &&
  !path.startsWith("__repro__/");

function appReferences(): References {
  const references: References = { literals: new Set(), patterns: [] };
  readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(SRC, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter(isAppSource)
    .forEach(path => collectReferences(path, readFileSync(join(SRC, path), "utf8"), references));
  return references;
}

function readBaseline(): string[] {
  return readFileSync(BASELINE, "utf8")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
}

describe("English translation keys", () => {
  const keys = baseKeys(translationEn);
  const unused = unusedKeys(keys, appReferences());
  const baseline = readBaseline();

  it("are all used, apart from the baseline", () => {
    const listed = new Set(baseline);
    // An entry here: use the key, or delete it from en/translation.json (Weblate drops it elsewhere).
    expect(unused.filter(key => !listed.has(key))).toEqual([]);
  });

  it("baseline lists only keys that exist and are still unused (it only shrinks)", () => {
    const stillUnused = new Set(unused);
    // An entry here: delete that line from src/locales/unusedKeysBaseline.txt.
    expect(baseline.filter(key => !stillUnused.has(key))).toEqual([]);
  });

  it("baseline is sorted and has no duplicates", () => {
    expect(baseline).toEqual([...new Set(baseline)].sort());
  });
});

describe("the unused-key check itself", () => {
  const source = [
    'const label = t("used.literal");',
    'const map = { a: "used.mapped" } as const;',
    "const kind = t(`stacks.typelabel.${type}`);",
    '<Trans i18nKey="used.trans" />;',
  ].join("\n");
  const references: References = { literals: new Set(), patterns: [] };
  collectReferences("sample.tsx", source, references);

  it("counts literals, typed map values, i18nKey props and template literals as uses", () => {
    const keys = new Set(["used.literal", "used.mapped", "used.trans", "stacks.typelabel.burst", "planted.unused"]);
    expect(unusedKeys(keys, references)).toEqual(["planted.unused"]);
  });

  it("folds plural forms into their base key", () => {
    expect([...baseKeys({ photos_one: "1 photo", photos_other: "{{count}} photos", title: "x" })]).toEqual([
      "photos",
      "title",
    ]);
  });
});
