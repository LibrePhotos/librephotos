/**
 * The edit recipe's bounds in zod against apps/backend/openapi.json. openapi.contract.test.ts
 * compares field names, types and nullability only; this compares every control's range (the
 * serializers read it from `CONTROLS` in apps/backend/api/editing/recipe.py), whether it is an
 * integer, a curve's point counts, the choices and the step's string lengths. A range changed on
 * one side fails here until the other side follows.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EditHistoryStep, EditRecipe } from "../schemas";

/** The parts of a JSON Schema (zod's, draft 2020-12) or an OpenAPI 3.0 schema node that bound a value. */
interface BoundsNode {
  type?: string | string[];
  minimum?: number;
  maximum?: number;
  /** A number in JSON Schema 2020-12 (zod), a flag on `minimum` in OpenAPI 3.0. */
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  minItems?: number;
  maxItems?: number;
  maxLength?: number;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, BoundsNode>;
  items?: BoundsNode | boolean;
  prefixItems?: BoundsNode[];
  allOf?: BoundsNode[];
  anyOf?: BoundsNode[];
  oneOf?: BoundsNode[];
  $ref?: string;
}

const BoundsNode: z.ZodType<BoundsNode> = z.lazy(() =>
  z.object({
    type: z.union([z.string(), z.string().array()]).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    exclusiveMinimum: z.union([z.number(), z.boolean()]).optional(),
    exclusiveMaximum: z.union([z.number(), z.boolean()]).optional(),
    minItems: z.number().optional(),
    maxItems: z.number().optional(),
    maxLength: z.number().optional(),
    enum: z.unknown().array().optional(),
    const: z.unknown().optional(),
    properties: z.record(z.string(), BoundsNode).optional(),
    items: z.union([z.boolean(), BoundsNode]).optional(),
    prefixItems: BoundsNode.array().optional(),
    allOf: BoundsNode.array().optional(),
    anyOf: BoundsNode.array().optional(),
    oneOf: BoundsNode.array().optional(),
    $ref: z.string().optional(),
  })
);

const components = z
  .object({ components: z.object({ schemas: z.record(z.string(), BoundsNode) }) })
  .parse(JSON.parse(readFileSync(new URL("../../../../apps/backend/openapi.json", import.meta.url), "utf8")))
  .components.schemas;

type Facts = Record<string, number | boolean | string>;

/** Each bounded path (`light.exposure`, `curve.master[][]`) and its bounds, either side's notation. */
function bounds(root: BoundsNode): Record<string, string> {
  const found = new Map<string, Facts>();
  const note = (path: string, facts: Facts) => {
    if (Object.keys(facts).length > 0) found.set(path, { ...found.get(path), ...facts });
  };
  const walk = (node: BoundsNode, path: string) => {
    if (node.$ref !== undefined) {
      const target = components[node.$ref.replace("#/components/schemas/", "")];
      if (target === undefined) throw new Error(`unknown component ${node.$ref}`);
      walk(target, path);
      return;
    }
    for (const branch of [...(node.allOf ?? []), ...(node.anyOf ?? []), ...(node.oneOf ?? [])]) walk(branch, path);
    for (const [key, child] of Object.entries(node.properties ?? {})) walk(child, path ? `${path}.${key}` : key);
    if (node.items !== undefined && typeof node.items !== "boolean") walk(node.items, `${path}[]`);
    for (const item of node.prefixItems ?? []) walk(item, `${path}[]`);

    const facts: Facts = {};
    const choices = [...(node.enum ?? []), ...(node.const !== undefined ? [node.const] : [])].filter(v => v !== null);
    if (choices.length > 0) {
      const previous = found.get(path)?.["choices"];
      const all = new Set([...(typeof previous === "string" ? previous.split("|") : []), ...choices.map(String)]);
      facts["choices"] = [...all].sort().join("|");
    } else if (node.type === "integer") {
      facts["integer"] = true;
    }
    for (const [side, exclusive] of [
      ["minimum", node.exclusiveMinimum],
      ["maximum", node.exclusiveMaximum],
    ] as const) {
      const value = typeof exclusive === "number" ? exclusive : node[side];
      if (value !== undefined) facts[side] = value;
      if (exclusive !== undefined && exclusive !== false) facts[`${side} exclusive`] = true;
    }
    if (node.minItems !== undefined) facts["minItems"] = node.minItems;
    if (node.maxItems !== undefined) facts["maxItems"] = node.maxItems;
    if (node.maxLength !== undefined) facts["maxLength"] = node.maxLength;
    note(path, facts);
  };
  walk(root, "");
  return Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b)).map(([p, f]) => [p, JSON.stringify(f)]));
}

const zodBounds = (schema: z.ZodType) => bounds(BoundsNode.parse(z.toJSONSchema(schema, { io: "input" })));
const componentBounds = (name: string) => bounds({ $ref: `#/components/schemas/${name}` });

describe("photo edit bounds: zod against apps/backend/openapi.json", () => {
  it.each([
    ["EditRecipe", "EditRecipe", EditRecipe],
    ["EditRecipe", "EditRecipeRequest", EditRecipe],
    ["EditHistoryStep", "EditHistoryStep", EditHistoryStep],
    ["EditHistoryStep", "EditHistoryStepRequest", EditHistoryStep],
  ])("%s has the bounds of %s", (_name, component, schema) => {
    expect(zodBounds(schema)).toEqual(componentBounds(component));
  });

  it("reads both notations the same way", () => {
    const recipe = zodBounds(EditRecipe);
    expect(recipe["light.exposure"]).toBe('{"minimum":-5,"maximum":5}');
    expect(recipe["geometry.crop.w"]).toBe('{"minimum":0,"minimum exclusive":true,"maximum":1}');
    expect(recipe["grain.seed"]).toBe('{"integer":true,"minimum":0,"maximum":4294967295}');
    expect(recipe["curve.master"]).toBe('{"minItems":2,"maxItems":16}');
    expect(recipe["curve.master[]"]).toBe('{"minItems":2,"maxItems":2}');
    expect(recipe["geometry.orientation"]).toBe('{"choices":"0|180|270|90"}');
    expect(Object.keys(recipe).length).toBeGreaterThan(90);
  });

  it("fails a range that differs", () => {
    const wider = EditRecipe.extend({ light: z.strictObject({ exposure: z.number().min(-6).max(5).optional() }) });
    expect(zodBounds(wider)["light.exposure"]).not.toBe(componentBounds("EditRecipe")["light.exposure"]);
  });
});
