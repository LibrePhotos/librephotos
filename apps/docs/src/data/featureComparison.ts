// The data model and filters behind <FeatureComparison>. Plain TypeScript without JSX or a JSON
// import, so scripts/feature-comparison.test.mjs runs it in Node as is.

export type Status = "yes" | "partial" | "plugin" | "paid" | "planned" | "no" | "na" | "unknown";

export type Cell = {
  /** Absent for rows that hold a value instead, such as the license. */
  s?: Status;
  /** A short value shown instead of (or next to) the status, e.g. "AGPL-3.0". */
  v?: string;
  /** What the status leaves out: the limitation, the plugin, the tier. */
  n?: string;
};

export type ProductKind = "server" | "desktop" | "saas";

export type Product = {
  id: string;
  name: string;
  url: string;
  kind: ProductKind;
  openSource: boolean;
  /** The version or date the research looked at. */
  checked: string;
};

export type Category = { id: string; label: string };

export type Feature = {
  id: string;
  name: string;
  category: string;
  /** One line on what counts, shown under the name. */
  hint?: string;
  cells: Record<string, Cell>;
};

export type Comparison = {
  checked: string;
  categories: Category[];
  products: Product[];
  features: Feature[];
};

export type Filters = {
  text: string;
  /** Empty means every category. */
  categories: string[];
  /** The columns shown, in the comparison's order. */
  products: string[];
  onlyDifferences: boolean;
  /** Features the reader needs; products missing one can be hidden. */
  mustHave: string[];
  hideMissingMustHave: boolean;
};

export const STATUS_LABEL: Record<Status, string> = {
  yes: "Yes",
  partial: "Partly",
  plugin: "Plugin",
  paid: "Paid",
  planned: "Planned",
  no: "No",
  na: "N/A",
  unknown: "Unknown",
};

/** Counts as having the feature when ticking it as a must-have: anything you can get today. */
export function isAvailable(cell: Cell | undefined): boolean {
  if (!cell) return false;
  if (cell.s) return cell.s === "yes" || cell.s === "partial" || cell.s === "plugin" || cell.s === "paid";
  return Boolean(cell.v);
}

function cellKey(cell: Cell | undefined): string {
  if (!cell) return "unknown";
  return `${cell.s ?? ""}|${cell.v ?? ""}`;
}

function matchesText(feature: Feature, products: readonly string[], text: string): boolean {
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [feature.name, feature.hint ?? "", feature.id];
  for (const id of products) {
    const cell = feature.cells[id];
    if (cell?.n) haystack.push(cell.n);
    if (cell?.v) haystack.push(cell.v);
  }
  return needle.split(/\s+/).every((word) => haystack.some((h) => h.toLowerCase().includes(word)));
}

/** True when the shown products do not all have the same answer for the feature. */
export function differs(feature: Feature, products: readonly string[]): boolean {
  const keys = new Set(products.map((id) => cellKey(feature.cells[id])));
  return keys.size > 1;
}

/** Products that have every must-have feature (all of them when there is none). */
export function productsMeeting(comparison: Comparison, mustHave: readonly string[]): string[] {
  const needed = comparison.features.filter((f) => mustHave.includes(f.id));
  return comparison.products
    .filter((p) => needed.every((f) => isAvailable(f.cells[p.id])))
    .map((p) => p.id);
}

/** How many of the must-have features each product has. */
export function mustHaveScore(comparison: Comparison, mustHave: readonly string[], productId: string): number {
  return comparison.features.filter((f) => mustHave.includes(f.id) && isAvailable(f.cells[productId])).length;
}

/** The columns to draw: the chosen products, minus those missing a must-have when asked. */
export function visibleProducts(comparison: Comparison, filters: Filters): Product[] {
  const meeting = filters.hideMissingMustHave ? new Set(productsMeeting(comparison, filters.mustHave)) : null;
  return comparison.products.filter(
    (p) => filters.products.includes(p.id) && (meeting === null || meeting.has(p.id)),
  );
}

/** The rows to draw. Must-have rows always stay, so ticking one never makes it vanish. */
export function visibleFeatures(comparison: Comparison, filters: Filters): Feature[] {
  const columns = visibleProducts(comparison, filters).map((p) => p.id);
  return comparison.features.filter((f) => {
    if (filters.mustHave.includes(f.id)) return true;
    if (filters.categories.length > 0 && !filters.categories.includes(f.category)) return false;
    if (!matchesText(f, columns, filters.text)) return false;
    if (filters.onlyDifferences && !differs(f, columns)) return false;
    return true;
  });
}

export function defaultFilters(comparison: Comparison): Filters {
  return {
    text: "",
    categories: [],
    products: comparison.products.map((p) => p.id),
    onlyDifferences: false,
    mustHave: [],
    hideMissingMustHave: false,
  };
}

/** The filters as a query string, leaving out whatever is at its default, so links stay short. */
export function filtersToQuery(comparison: Comparison, filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.text.trim()) params.set("q", filters.text.trim());
  if (filters.categories.length > 0) params.set("cat", filters.categories.join(","));
  if (filters.products.length !== comparison.products.length) params.set("apps", filters.products.join(","));
  if (filters.onlyDifferences) params.set("diff", "1");
  if (filters.mustHave.length > 0) params.set("need", filters.mustHave.join(","));
  if (filters.hideMissingMustHave) params.set("strict", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Reads a query string written by filtersToQuery, dropping ids the comparison does not know. */
export function filtersFromQuery(comparison: Comparison, search: string): Filters {
  const params = new URLSearchParams(search);
  const list = (key: string, known: readonly string[]): string[] | null => {
    const raw = params.get(key);
    if (raw === null) return null;
    const wanted = new Set(raw.split(",").filter(Boolean));
    return known.filter((id) => wanted.has(id));
  };
  const defaults = defaultFilters(comparison);
  return {
    text: params.get("q") ?? "",
    categories: list("cat", comparison.categories.map((c) => c.id)) ?? defaults.categories,
    products: list("apps", comparison.products.map((p) => p.id)) ?? defaults.products,
    onlyDifferences: params.get("diff") === "1",
    mustHave: list("need", comparison.features.map((f) => f.id)) ?? defaults.mustHave,
    hideMissingMustHave: params.get("strict") === "1",
  };
}
