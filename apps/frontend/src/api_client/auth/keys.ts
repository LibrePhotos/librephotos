const root = ["auth"] as const;

export const authKeys = {
  all: root,
  accessToken: () => [...root, "accessToken"] as const,
  isAuthenticated: () => [...root, "isAuthenticated"] as const,
  firstTimeSetup: () => [...root, "firstTimeSetup"] as const,
  ssoConfig: () => [...root, "ssoConfig"] as const,
};
