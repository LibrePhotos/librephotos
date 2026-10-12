const root = ["settings"] as const;

export const settingsKeys = {
  all: root,
  site: () => [...root, "site"] as const,
  emailConfig: () => [...root, "emailConfig"] as const,
  predefinedBurstRules: () => [...root, "predefinedBurstRules"] as const,
  predefinedRules: () => [...root, "predefinedRules"] as const,
  timezones: () => [...root, "timezones"] as const,
};
