// @vitest-environment node
/**
 * The tables and white balance values against the server's goldens
 * (apps/backend/api/editing/testdata/goldens.json, "Golden file" in the pipeline doc): both
 * renderers compute them with plain functions, and they must agree to 1e-4.
 */
import { readFileSync } from "node:fs";
import { EditRecipe } from "@librephotos/api-client";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toDense } from "./recipe";
import { curveTable, hueTable, lightTable, whiteBalance } from "./tables";

const TOLERANCE = 1e-4;
const triple = z.tuple([z.number(), z.number(), z.number()]);

const Goldens = z.object({
  format: z.literal(1),
  table_indices: z.int().array().length(65),
  hue_degrees: z.int().array().length(72),
  cases: z
    .object({
      name: z.string(),
      recipe: z.unknown(),
      light: z.number().array().nullable(),
      curve: triple.array().nullable(),
      hue: z.tuple([z.number(), z.number(), z.number(), z.number()]).array().nullable(),
      runs: z
        .object({
          source_max: z.number(),
          wb: z.object({ k: triple, gain: z.number(), M: z.number() }),
        })
        .array(),
    })
    .array()
    .min(1),
});

const goldens = Goldens.parse(
  JSON.parse(readFileSync(new URL("../../../../../backend/api/editing/testdata/goldens.json", import.meta.url), "utf8"))
);

/** The largest difference between two lists of numbers (Infinity when their lengths differ). */
function worst(actual: readonly number[], expected: readonly number[]): number {
  if (actual.length !== expected.length) return Infinity;
  return actual.reduce((max, value, i) => Math.max(max, Math.abs(value - (expected[i] ?? NaN))), 0);
}

const at = (table: Float32Array, index: number) => table[index] ?? NaN;

describe("tables against the server's goldens", () => {
  it.each(goldens.cases.map(c => [c.name, c] as const))("%s", (_name, golden) => {
    const recipe = toDense(EditRecipe.parse(golden.recipe));
    const indices = goldens.table_indices;

    const light = lightTable(recipe.light);
    const lightExpected = golden.light ?? indices.map(i => i / 1023);
    expect(
      worst(
        indices.map(i => at(light, i)),
        lightExpected
      )
    ).toBeLessThanOrEqual(TOLERANCE);

    const curve = curveTable(recipe.curve);
    const curveExpected = (golden.curve ?? indices.map(i => [i / 1023, i / 1023, i / 1023])).flat();
    const curveActual = indices.flatMap(i => [at(curve, i * 3), at(curve, i * 3 + 1), at(curve, i * 3 + 2)]);
    expect(worst(curveActual, curveExpected)).toBeLessThanOrEqual(TOLERANCE);

    const hue = hueTable(recipe.mixer, recipe.bw_mix);
    const hueExpected = (golden.hue ?? goldens.hue_degrees.map(() => [0, 0, 0, 0])).flat();
    const hueActual = goldens.hue_degrees.flatMap(h => [0, 1, 2, 3].map(c => at(hue, h * 4 + c)));
    expect(worst(hueActual, hueExpected)).toBeLessThanOrEqual(TOLERANCE);

    for (const run of golden.runs) {
      const { k, gain, M } = whiteBalance(recipe.wb, recipe.light.exposure, run.source_max);
      expect(worst([...k, gain, M], [...run.wb.k, run.wb.gain, run.wb.M])).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});
