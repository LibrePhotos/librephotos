const root = ["geocode"] as const;

export const geocodeKeys = {
  all: root,
  search: (query: string) => [...root, "search", query] as const,
};
