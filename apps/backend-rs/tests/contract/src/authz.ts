import { call, type Request } from "./client";
import { BASE_URL, REF_URL } from "./env";
import { ROLES, type Role } from "./manifest";

export interface AuthzCase {
  name: string;
  req: Request;
  /** Roles to try; default all six. */
  roles?: readonly Role[];
  /**
   * Statuses the reference itself must give (pins today's Django behaviour, so
   * a surprise on the reference side is noticed too). Unlisted roles are only
   * compared between the two servers.
   */
  expect?: Partial<Record<Role, number>>;
  /** Response headers that must match per cell, e.g. ["x-media-error"]. */
  headers?: string[];
}

export interface AuthzCell {
  role: Role;
  ref: number;
  actual: number;
  refHeaders: Record<string, string | null>;
  actualHeaders: Record<string, string | null>;
}

export type AuthzMatrix = Record<string, AuthzCell[]>;

async function statusOf(role: Role, c: AuthzCase, baseUrl: string) {
  // Media answers may be large; only the status and headers matter here.
  const res = await call(role, { ...c.req, redirect: c.req.redirect ?? "manual" }, baseUrl);
  const headers: Record<string, string | null> = {};
  for (const name of c.headers ?? []) headers[name] = res.headers.get(name);
  return { status: res.status, headers };
}

/** role x request -> status on the reference and on the server under test. */
export async function authzMatrix(cases: AuthzCase[]): Promise<AuthzMatrix> {
  const matrix: AuthzMatrix = {};
  for (const c of cases) {
    const cells: AuthzCell[] = [];
    for (const role of c.roles ?? ROLES) {
      const ref = await statusOf(role, c, REF_URL);
      const actual = await statusOf(role, c, BASE_URL);
      cells.push({ role, ref: ref.status, actual: actual.status, refHeaders: ref.headers, actualHeaders: actual.headers });
    }
    matrix[c.name] = cells;
  }
  return matrix;
}

/** Mismatching cells of one case, as readable lines (empty = pass). */
export function authzProblems(c: AuthzCase, cells: AuthzCell[]): string[] {
  const problems: string[] = [];
  for (const cell of cells) {
    const pinned = c.expect?.[cell.role];
    if (pinned !== undefined && cell.ref !== pinned) {
      problems.push(`${cell.role}: reference gave ${cell.ref}, case expects ${pinned}`);
    }
    if (cell.ref !== cell.actual) problems.push(`${cell.role}: reference ${cell.ref}, actual ${cell.actual}`);
    for (const name of c.headers ?? []) {
      if (cell.refHeaders[name] !== cell.actualHeaders[name]) {
        problems.push(`${cell.role}: header ${name} reference=${cell.refHeaders[name]} actual=${cell.actualHeaders[name]}`);
      }
    }
  }
  return problems;
}

/** Render a matrix as a table (for logs / pinning `expect` from the reference). */
export function formatMatrix(matrix: AuthzMatrix): string {
  const lines = [`case | ${ROLES.join(" | ")}`];
  for (const [name, cells] of Object.entries(matrix)) {
    const byRole = new Map(cells.map(c => [c.role, c.ref === c.actual ? `${c.ref}` : `${c.ref}!=${c.actual}`]));
    lines.push(`${name} | ${ROLES.map(r => byRole.get(r) ?? "-").join(" | ")}`);
  }
  return lines.join("\n");
}
