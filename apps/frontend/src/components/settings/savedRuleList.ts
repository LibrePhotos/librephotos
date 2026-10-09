// A user's saved rule list (datetime_rules, burst_detection_rules). The server stores the list a
// client sent, so an entry can be something the rule schema does not read: a rule type added
// later, or a rule a script saved with other keys. The settings page lists and edits the rules it
// reads, and saves every other entry back unchanged, in its place in the list.

/** The saved list: an array, or the JSON string of one. Anything else reads as an empty list. */
export function readSavedList(value: unknown): unknown[] {
  let list: unknown = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) ? list : [];
}

/** The `id` of every saved entry that has one, whether or not the schema reads the entry. */
export function savedIds(entries: readonly unknown[]): unknown[] {
  return entries.flatMap(entry => (typeof entry === "object" && entry !== null && "id" in entry ? [entry.id] : []));
}

/**
 * The saved entries with the rules in a new order: each slot that held a rule takes the next rule
 * of `rules`, and every other entry keeps its place. `rules` holds the rules of `entries`,
 * reordered.
 */
export function withRuleOrder<Rule>(
  entries: readonly unknown[],
  isRule: (entry: unknown) => entry is Rule,
  rules: readonly Rule[]
): unknown[] {
  let next = 0;
  return entries.map(entry => (isRule(entry) && next < rules.length ? rules[next++] : entry));
}
