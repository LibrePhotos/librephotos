import { call, type Request, type Response } from "./client";
import { BASE_URL, REF_URL } from "./env";
import type { Role } from "./manifest";
import {
  buildSelector,
  diff,
  formatDifferences,
  normalize,
  project,
  type CompareOptions,
  type Difference,
} from "./project";

export interface TwinSpec extends CompareOptions {
  /** Paths the frontend reads; see project.ts. Empty = whole body. */
  project: string[];
  /**
   * Call the reference twice first and fail if it disagrees with itself: the
   * case then needs `unordered` for the arrays Django does not order. On by
   * default; turn off for endpoints that change state between calls.
   */
  refStable?: boolean;
  /** Response headers whose values must match too (e.g. "x-media-error"). */
  headers?: string[];
}

export interface TwinResult {
  ref: Response;
  actual: Response;
  differences: Difference[];
}

/**
 * Send `req` as `role` to the reference (LP_REF_URL, Django) and to the server
 * under test (LP_BASE_URL) and compare status plus the projection of the body.
 */
export async function twin(role: Role, req: Request, spec: TwinSpec): Promise<TwinResult> {
  const selector = buildSelector(spec.project);
  const opts: CompareOptions = { ...spec, origins: [REF_URL, BASE_URL, ...(spec.origins ?? [])] };
  const view = (res: Response) => normalize(project(res.body, selector), opts);

  const ref = await call(role, req, REF_URL);
  if (spec.refStable ?? true) {
    const again = await call(role, req, REF_URL);
    const drift = diff(view(ref), view(again), opts);
    if (ref.status !== again.status || drift.length > 0) {
      throw new Error(
        `reference is not deterministic for ${req.method ?? "GET"} ${req.path} as ${role}; ` +
          `mark these arrays unordered or project less:\n${formatDifferences(drift)}`,
      );
    }
  }
  const actual = await call(role, req, BASE_URL);

  const differences: Difference[] = [];
  if (ref.status !== actual.status) differences.push({ path: "<status>", ref: ref.status, actual: actual.status });
  for (const name of spec.headers ?? []) {
    const a = ref.headers.get(name);
    const b = actual.headers.get(name);
    if (a !== b) differences.push({ path: `<header ${name}>`, ref: a, actual: b });
  }
  differences.push(...diff(view(ref), view(actual), opts));
  return { ref, actual, differences };
}

/** `twin` that throws with a readable report when anything differs. */
export async function expectTwin(role: Role, req: Request, spec: TwinSpec): Promise<TwinResult> {
  const result = await twin(role, req, spec);
  if (result.differences.length > 0) {
    throw new Error(
      `${req.method ?? "GET"} ${req.path} as ${role} differs from the reference:\n` +
        formatDifferences(result.differences),
    );
  }
  return result;
}
