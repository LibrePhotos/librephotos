// The stack schemas and types are in @librephotos/api-client.
// Duplicates (exact copies, visual duplicates) are in api_client/duplicates.
// RAW + JPEG pairs and Live Photos use file variants instead of stacks.

/** The photos a stack change applies to (merge, create, remove). */
export type StackPhotosRequest = {
  photo_hashes: string[];
};

// Display labels are translated: stacks.typelabel.<type> names one stack,
// stacks.types.<type> the filter entry for all stacks of that type.
