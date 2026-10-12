import { readdirSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// A file name is one word or camel case: no dashes or underscores before the first dot. The
// convention itself (components PascalCase.tsx, hooks useX, other modules camelCase.ts) is in
// AGENTS.md. Routes are exempt: the TanStack router reads $params, _layouts and -ignored files there.
const NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const EXEMPT_FILES = new Set(["vite-env.d.ts"]);

function badNames(paths: string[]): string[] {
  return paths.filter(path => {
    const name = basename(path);
    return !EXEMPT_FILES.has(name) && !NAME.test(name.split(".")[0] ?? "");
  });
}

// `yarn test` runs from apps/frontend, which is where src/ is.
const SRC = resolve("src");
const srcFiles = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => relative(SRC, join(entry.parentPath, entry.name)).split(sep).join("/"))
  .filter(path => !path.startsWith("locales/") && !path.startsWith("routes/"));

describe("file names in src", () => {
  it("have no dashes or underscores", () => {
    expect(badNames(srcFiles)).toEqual([]);
  });

  it("the check flags a dashed or underscored name and passes a camel case one", () => {
    expect(badNames(["components/foo-bar.tsx", "components/FooBar.tsx", "service/use_thing.ts"])).toEqual([
      "components/foo-bar.tsx",
      "service/use_thing.ts",
    ]);
  });
});
