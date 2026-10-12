const root = ["services"] as const;

export const serviceKeys = {
  all: root,
  list: () => [...root, "list"] as const,
  /** Every health check, whichever services it covers. */
  healths: () => [...root, "health"] as const,
  health: (serviceNames: string[]) => [...serviceKeys.healths(), serviceNames] as const,
};
