type PlaceNode = Readonly<{ name: string; children?: readonly PlaceNode[] }>;

/**
 * The places open when the place tree first shows: the root and each place under it, so the tree
 * opens two levels deep (countries and their regions) instead of as one lone node.
 */
export function initiallyOpenPlaces(root: PlaceNode | undefined): Set<string> {
  if (!root) return new Set();
  return new Set([root.name, ...(root.children ?? []).map(child => child.name)]);
}
