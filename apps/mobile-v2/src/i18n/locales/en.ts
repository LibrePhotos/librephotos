/**
 * English base strings. Other locales come from Weblate (do not hand-edit
 * non-English files). Keys are grouped by screen/domain.
 */
export const en = {
  common: {
    appName: "LibrePhotos",
    retry: "Retry",
    loading: "Loading…",
  },
  login: {
    title: "Sign in",
    serverUrl: "Server URL",
    serverUrlPlaceholder: "https://photos.example.com",
    username: "Username",
    password: "Password",
    submit: "Sign in",
    signingIn: "Signing in…",
    missingServer: "Enter your server URL first",
    failed: "Sign-in failed. Check your server URL and credentials.",
  },
  tabs: {
    photos: "Photos",
    albums: "Albums",
    search: "Search",
    backup: "Backup",
    profile: "Profile",
  },
  timeline: {
    title: "Photos",
    empty: "No photos yet",
    error: "Could not load your timeline",
  },
  profile: {
    logout: "Log out",
    syncStatus: "Sync status",
  },
  sync: {
    title: "Sync status",
    running: "Syncing…",
    idle: "Up to date",
    entities: "Mirror",
    lastRun: "Last run",
    upTo: "Up to",
    syncNow: "Sync now",
    exportLogs: "Export logs",
    repair: "Repair sync",
    log: "Log",
    logEmpty: "No sync activity yet",
  },
} as const;

export type Translation = typeof en;
