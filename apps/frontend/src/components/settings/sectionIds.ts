/**
 * The anchors of the cards on /settings and /admin (#2226). They are part of the URL
 * (`/settings#settings-faces`), so links in docs, support answers and other pages depend on them:
 * rename a card, keep its id.
 */
export const SETTINGS_SECTIONS = {
  scan: "settings-scan",
  metadata: "settings-metadata",
  faces: "settings-faces",
  datetime: "settings-datetime",
  burst: "settings-burst",
  experimental: "settings-experimental",
  captions: "settings-captions",
  sharing: "settings-sharing",
  interface: "settings-interface",
  duplicates: "settings-duplicates",
} as const;

export const ADMIN_SECTIONS = {
  upgrade: "admin-upgrade",
  site: "admin-site",
  features: "admin-features",
  email: "admin-email",
  tools: "admin-tools",
  logs: "admin-logs",
  services: "admin-services",
  users: "admin-users",
  jobs: "admin-jobs",
} as const;
