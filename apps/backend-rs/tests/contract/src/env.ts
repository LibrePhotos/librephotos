/**
 * Where the harness points.
 *
 *   LP_BASE_URL   server under test (Rust), e.g. http://127.0.0.1:8932
 *   LP_REF_URL    reference server (Django on a clone of the same template);
 *                 defaults to LP_BASE_URL, which turns every twin case into a
 *                 self-comparison (useful to validate the harness on Django)
 *   LP_MANIFEST   manifest.json written by build_fixture.sh
 */
export const BASE_URL = trimSlash(process.env.LP_BASE_URL ?? "");
export const REF_URL = trimSlash(process.env.LP_REF_URL ?? process.env.LP_BASE_URL ?? "");
export const MANIFEST_PATH =
  process.env.LP_MANIFEST ?? "C:/Users/Niaz/librephotos/rust-pg/fixture/manifest.json";

export const hasBase = BASE_URL !== "";
export const hasRef = REF_URL !== "";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
