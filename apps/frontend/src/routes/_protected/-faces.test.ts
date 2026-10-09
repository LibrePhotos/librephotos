/**
 * The faces dashboard keeps its filters in the URL. A confidence of 0 ("show every
 * suggestion") is a valid choice from the NumberInput (min=0), so it must survive
 * validateSearch instead of snapping back to the 70 % default.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

type FacesSearch = {
  tab: string;
  method: string;
  orderBy: string;
  minConfidence: number;
};

// The Standard Schema interface TanStack Router validates the search with
type ValidationResult = { value: FacesSearch } | { issues: readonly unknown[] };
type SearchValidator = {
  "~standard": { validate: (value: unknown) => ValidationResult | Promise<ValidationResult> };
};

const stubs = vi.hoisted(() => {
  const captured: { validateSearch: SearchValidator | null } = { validateSearch: null };
  return captured;
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { validateSearch: SearchValidator }) => {
    stubs.validateSearch = options.validateSearch;
    return {};
  },
}));
vi.mock("../../components/facedashboard/FaceDashboard", () => ({ FaceDashboard: () => null }));
// Only the enums are needed; the hooks behind the index pull in the whole API client
vi.mock("../../api_client/faces", () => import("../../api_client/faces/types"));

let validate: (search: Record<string, unknown>) => FacesSearch;

beforeAll(async () => {
  await import("./faces");
  const validator = stubs.validateSearch;
  if (!validator) throw new Error("the faces route has no validateSearch");
  // As the router does it: a promise or any issue would be an error page
  validate = search => {
    const result = validator["~standard"].validate(search);
    if (result instanceof Promise) throw new Error("validateSearch must be synchronous");
    if (!("value" in result)) throw new Error(`validateSearch rejected ${JSON.stringify(search)}`);
    return result.value;
  };
}, 60000);

describe("faces route search", () => {
  it("keeps a confidence of 0", () => {
    expect(validate({ minConfidence: 0 }).minConfidence).toBe(0);
  });

  it("keeps other valid confidences", () => {
    expect(validate({ minConfidence: 0.5 }).minConfidence).toBe(0.5);
    expect(validate({ minConfidence: 1 }).minConfidence).toBe(1);
  });

  it("falls back to 70 % for a missing or non-numeric confidence", () => {
    expect(validate({}).minConfidence).toBe(0.7);
    expect(validate({ minConfidence: "abc" }).minConfidence).toBe(0.7);
    expect(validate({ minConfidence: Number.NaN }).minConfidence).toBe(0.7);
    expect(validate({ minConfidence: Number.POSITIVE_INFINITY }).minConfidence).toBe(0.7);
  });

  it("clamps an out-of-range confidence instead of resetting it", () => {
    // The NumberInput reports 150 % (1.5) while "150" is typed; it must not jump to 70
    expect(validate({ minConfidence: 1.5 }).minConfidence).toBe(1);
    expect(validate({ minConfidence: 5 }).minConfidence).toBe(1);
    expect(validate({ minConfidence: -0.1 }).minConfidence).toBe(0);
  });

  it("falls back to the defaults for an unknown tab or method", () => {
    expect(validate({ tab: "bogus", method: "bogus" })).toMatchObject({ tab: "inferred", method: "clustering" });
    expect(validate({ tab: "labeled", method: "classification" })).toMatchObject({
      tab: "labeled",
      method: "classification",
    });
  });

  it("keeps a known order and falls back to confidence for any other", () => {
    expect(validate({}).orderBy).toBe("confidence");
    expect(validate({ orderBy: "date" }).orderBy).toBe("date");
    expect(validate({ orderBy: "person" }).orderBy).toBe("person");
    expect(validate({ orderBy: "bogus" }).orderBy).toBe("confidence");
    expect(validate({ orderBy: 5 }).orderBy).toBe("confidence");
  });

  it("reads a date order in any case, as the backend does", () => {
    expect(validate({ orderBy: "DATE" }).orderBy).toBe("date");
    expect(validate({ orderBy: "Date" }).orderBy).toBe("date");
    // Only an exact "person" ever meant the date order; the backend sorted the rest by confidence
    expect(validate({ orderBy: "Person" }).orderBy).toBe("confidence");
    expect(validate({ orderBy: "CONFIDENCE" }).orderBy).toBe("confidence");
  });

  it("fills in every default for a link without search params", () => {
    expect(validate({})).toEqual({ tab: "inferred", method: "clustering", orderBy: "confidence", minConfidence: 0.7 });
  });
});
