/// <reference types="vite/client" />

// The variables the app reads from import.meta.env. Vite types every other key
// as `any`; naming these keeps their reads typed.
interface ImportMetaEnv {
  /** The path the app is served under, e.g. "/librephotos" (see vite.config.ts). */
  readonly VITE_PUBLIC_URL?: string;
  /** The same, under its pre-Vite name. */
  readonly PUBLIC_URL?: string;
  /** "true" turns on why-did-you-render in the dev server (see wdyr.ts). */
  readonly VITE_APP_WDYR?: string;
}
