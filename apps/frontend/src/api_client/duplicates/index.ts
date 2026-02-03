/**
 * Duplicates API client.
 *
 * Handles duplicate photo detection and cleanup:
 * - exact_copy: Byte-for-byte identical files
 * - visual_duplicate: Visually similar photos
 *
 * For organizational photo grouping (RAW+JPEG pairs, bursts, live photos),
 * use the stacks API instead (`api_client/stacks`).
 */
export * from "./hooks";
export * from "./types";
