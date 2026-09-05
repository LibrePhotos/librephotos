import type { ComboboxItem, OptionsFilter } from "@mantine/core";

/** How many suggestions to show at once. Enough to scan without scrolling. */
export const TAG_SUGGESTION_LIMIT = 10;

/**
 * Suggest tags prefix-first: what you typed at the start of a name wins.
 *
 * Mantine's default filter keeps whatever order the options arrived in and
 * matches anywhere in the name, so typing `be` offered `Alberta` above `beach`
 * purely because the list is alphabetical. Names that *start* with the query
 * come first here, and names that merely contain it follow, so the search
 * stays useful for someone who half-remembers a tag while behaving like a
 * jump-to-letter for someone who knows exactly what they want.
 *
 * Alphabetical order within each of the two groups is inherited from the
 * server, which orders tags by name.
 */
export const tagOptionsFilter: OptionsFilter = ({ options, search, limit }) => {
  // Tag data is a flat list of names, never grouped.
  const items = options.filter((option): option is ComboboxItem => !("group" in option));
  const query = search.trim().toLowerCase();

  if (query.length === 0) {
    return items.slice(0, limit);
  }

  const startsWithQuery: ComboboxItem[] = [];
  const containsQuery: ComboboxItem[] = [];

  items.forEach(item => {
    const label = item.label.toLowerCase();
    if (label.startsWith(query)) {
      startsWithQuery.push(item);
    } else if (label.includes(query)) {
      containsQuery.push(item);
    }
  });

  return [...startsWithQuery, ...containsQuery].slice(0, limit);
};
