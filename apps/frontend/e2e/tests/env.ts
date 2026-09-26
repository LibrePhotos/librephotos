/** Credentials and seed expectations, overridable from the environment. */
export const ADMIN_USERNAME = process.env.E2E_USERNAME ?? "admin";
export const ADMIN_PASSWORD = process.env.E2E_PASSWORD ?? "admin";

/**
 * Where the backend finds the sample library (deploy/e2e/photos). The e2e compose
 * stack copies it to /data; for a native backend, pass a path inside its DATA_ROOT.
 */
export const SCAN_DIRECTORY = process.env.E2E_SCAN_DIR ?? "/data";

/** Number of photos in deploy/e2e/photos, and the two days they were taken on. */
export const SEED_PHOTO_COUNT = 8;
export const SEED_DAYS = ["Sunday, May 12, 2024", "Thursday, August 3, 2023"];
