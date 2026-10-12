import type { DuplicateListItem } from "@librephotos/api-client";

// The duplicate schemas are shared with the mobile app and live in packages/api-client.
export { DuplicateDetail, DuplicatePhoto, DuplicateType, ReviewStatus } from "@librephotos/api-client";
export type { DetectDuplicatesRequest } from "@librephotos/api-client";

/** A row of the duplicate list. */
export type Duplicate = DuplicateListItem;

// Display labels: use the translated duplicates.types.<type> and duplicates.<status> keys
