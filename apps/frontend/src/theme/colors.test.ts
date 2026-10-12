// @vitest-environment node
// light-dark() survives a production build. Builds colors.css with a light-dark() probe through Vite
// (its CSS minifier, Lightning CSS, rewrites light-dark() into variables) and checks that every
// variable the rewrite reads is set for both of Mantine's colour schemes. The dev server never
// rewrites light-dark(), so without this the breakage only shows in a release.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { defined } from "../util/defined.test-utils";

const root = mkdtempSync(join(tmpdir(), "light-dark-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function builtCss(): Promise<string> {
  const colors = readFileSync(resolve("src/theme/colors.css"), "utf8");
  writeFileSync(join(root, "probe.css"), `${colors}\n.probe { color: light-dark(#010203, #040506); }\n`);
  writeFileSync(join(root, "main.js"), `import "./probe.css";\n`);
  const result = await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: { write: false, rolldownOptions: { input: join(root, "main.js") } },
  });
  return (Array.isArray(result) ? result : [result])
    .flatMap(output => ("output" in output ? output.output : []))
    .flatMap(file => (file.type === "asset" && file.fileName.endsWith(".css") ? [file.source] : []))
    .map(source => (typeof source === "string" ? source : new TextDecoder().decode(source)))
    .join("\n");
}

/** The custom properties set by minified rules whose selector ends in `selector`. */
function declaredIn(css: string, selector: string): string[] {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, selectors = ""]) => selectors.split(",").some(s => s.trim().endsWith(selector)))
    .flatMap(([, , body = ""]) => [...body.matchAll(/(--[\w-]+):/g)].flatMap(([, name]) => name ?? []));
}

describe("light-dark() in a production build", () => {
  it("sets every variable the minifier's light-dark() rewrite reads, for both colour schemes", async () => {
    const css = await builtCss();
    const probe = defined(css.match(/\.probe\{color:([^}]*)\}/)?.[1]);

    // A minifier that leaves light-dark() as it is needs nothing from us.
    if (probe.includes("light-dark(")) return;
    const read = [...probe.matchAll(/var\((--[\w-]+),/g)].flatMap(([, name]) => name ?? []);
    expect(read.length, `expected light-dark() or its var() rewrite, got: ${probe}`).toBeGreaterThan(0);

    for (const scheme of ["light", "dark"]) {
      const selector = `[data-mantine-color-scheme=${scheme}]`;
      expect(declaredIn(css, selector), selector).toEqual(expect.arrayContaining(read));
    }
  }, 30_000);
});
