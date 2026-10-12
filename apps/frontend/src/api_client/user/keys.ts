const root = ["user"] as const;

export const userKeys = {
  all: root,
  list: () => [...root, "list"] as const,
  /** The signed-in user's details, whoever that is. */
  selfDetails: () => [...root, "self"] as const,
  selfDetail: (userId: string) => [...userKeys.selfDetails(), userId] as const,
};
