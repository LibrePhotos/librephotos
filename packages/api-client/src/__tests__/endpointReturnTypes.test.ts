/**
 * Every endpoint function returns a parsed type: its response goes through
 * parseResponse with a schema (a mutation without a useful body gets a small
 * one, like StatusResponse), so a caller never gets `unknown` back and server
 * drift fails loudly in one place. Issue #2347.
 *
 * Reads the exported functions of ../endpoints with the TypeScript checker and
 * fails on one whose awaited return type is `unknown` or `any`.
 * UNPARSED_ENDPOINTS lists the ones that still do, from before the rule; it
 * only shrinks: a listed function that returns a parsed type now fails too, so
 * the entry goes in the same PR.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const UNPARSED_ENDPOINTS: readonly string[] = ["setPhotosPublic", "setPhotosShared"];

const endpointsFile = fileURLToPath(new URL("../endpoints/index.ts", import.meta.url));

/**
 * zod from the project the tests run in: the package's own install (api-client.yml) or the web
 * app's (its vitest runs this suite), whichever is the working directory. From packages/ itself
 * a frontend-only checkout finds none, and every schema type would turn into `any`.
 */
function zodTypesDir(): string {
  const require = createRequire(path.join(process.cwd(), "package.json"));
  return path.dirname(require.resolve("zod/package.json"));
}

/** Exported function name -> its awaited return type, as the checker prints it. */
function endpointReturnTypes(): Map<string, { text: string; untyped: boolean }> {
  const program = ts.createProgram([endpointsFile], {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    paths: { zod: [zodTypesDir()] },
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(endpointsFile);
  if (!source) throw new Error(`cannot read ${endpointsFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) throw new Error(`${endpointsFile} is not a module`);

  const result = new Map<string, { text: string; untyped: boolean }>();
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const type = checker.getTypeOfSymbolAtLocation(symbol, source);
    for (const signature of type.getCallSignatures()) {
      const returned = checker.getReturnTypeOfSignature(signature);
      const awaited = checker.getAwaitedType(returned) ?? returned;
      const untyped = (awaited.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) !== 0;
      result.set(symbol.getName(), { text: checker.typeToString(returned), untyped });
    }
  }
  return result;
}

describe("endpoint return types", () => {
  const returnTypes = endpointReturnTypes();
  const untyped = [...returnTypes].filter(([, { untyped }]) => untyped).map(([name]) => name);

  it("reads the endpoint module with its schema types", () => {
    // Without zod every parsed type would be `any` and the checks below would mean nothing.
    expect(returnTypes.get("login")).toEqual({ text: "Promise<{ refresh: string; access: string; }>", untyped: false });
  });

  it("has no endpoint returning unknown or any that is not in UNPARSED_ENDPOINTS", () => {
    const fresh = untyped.filter(name => !UNPARSED_ENDPOINTS.includes(name));
    expect(fresh, "parse the response with a schema (parseResponse) and return its type").toEqual([]);
  });

  it("has no UNPARSED_ENDPOINTS entry that returns a parsed type now (the list only shrinks)", () => {
    const stale = UNPARSED_ENDPOINTS.filter(name => !untyped.includes(name));
    expect(stale, "delete these entries").toEqual([]);
  });
});
