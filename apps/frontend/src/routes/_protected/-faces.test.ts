/**
 * The faces dashboard keeps its filters in the URL. A confidence of 0 ("show every
 * suggestion") is a valid choice from the NumberInput (min=0), so it must survive
 * validateSearch instead of snapping back to the 70 % default.
 *
 * The leading "-" keeps the TanStack router plugin from treating this file as a route.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

type Validate = (search: Record<string, unknown>) => {
  tab: string;
  method: string;
  orderBy: string;
  minConfidence: number;
};

const stubs = vi.hoisted(() => ({ validateSearch: undefined as Validate | undefined }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { validateSearch: Validate }) => {
    stubs.validateSearch = options.validateSearch;
    return {};
  },
}));
vi.mock("../../components/facedashboard/FaceDashboard", () => ({ FaceDashboard: () => null }));
// Only the enums are needed; the hooks behind the index pull in the whole API client
vi.mock("../../api_client/faces", () => import("../../api_client/faces/types"));

let validate: Validate;

beforeAll(async () => {
  await import("./faces");
  validate = stubs.validateSearch!;
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
});
