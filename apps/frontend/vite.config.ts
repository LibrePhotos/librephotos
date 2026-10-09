import { fileURLToPath } from "node:url";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { loadEnv, searchForWorkspaceRoot } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

// The shared API client (packages/api-client) ships TypeScript source and is
// compiled as part of this app, through an alias rather than an installed
// dependency (tsconfig.json mirrors it under "paths"). This app stays a
// standalone Yarn project; it is not part of the root npm workspace.
const apiClientSrc = fileURLToPath(new URL("../../packages/api-client/src", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const publicUrl = env.PUBLIC_URL || env.VITE_PUBLIC_URL || "/";

  // Why Did You Render. Under the automatic JSX runtime, elements are created
  // by jsxDEV() rather than React.createElement, so the React patch that
  // src/wdyr.ts applies never sees them. WDYR ships a jsx-dev-runtime wrapper
  // for exactly this; point the transform at it. Only when WDYR is actually
  // switched on, so a normal dev server keeps the stock transform.
  const wdyr = mode !== "production" && env.VITE_APP_WDYR === "true";

  // Native dev without the nginx proxy: forward the backend paths to it, so
  // the app stays same-origin (VITE_PUBLIC_URL unset).
  const backend = env.VITE_BACKEND_URL;
  const proxy = backend
    ? Object.fromEntries(["/api", "/media"].map(p => [p, { target: backend, changeOrigin: true }]))
    : undefined;

  return {
    base: publicUrl,
    plugins: [
      // Code splitting only picks up `component` & co. passed in the
      // createFileRoute(...)({...}) options, and never an identifier that is
      // also exported from the route file. Under vitest it is switched off, so
      // tests that mock @tanstack/react-router get the real component back
      // rather than a lazyRouteComponent wrapper.
      tanstackRouter({ target: "react", autoCodeSplitting: !process.env.VITEST }),
      react(wdyr ? { jsxImportSource: "@welldone-software/why-did-you-render" } : {}),
    ],
    resolve: {
      // `lodash` is CommonJS, so any `from "lodash"` import (even a named one)
      // drags the whole library into the bundle. Send bare `lodash` imports to
      // the ES-module build so they tree-shake; import from "lodash-es" in new
      // code. Deep imports such as "lodash/debounce" are left alone.
      alias: [
        { find: /^lodash$/, replacement: "lodash-es" },
        { find: /^@librephotos\/api-client$/, replacement: `${apiClientSrc}/index.ts` },
        { find: /^@librephotos\/api-client\/(schemas|transport|hooks)$/, replacement: `${apiClientSrc}/$1/index.ts` },
      ],
      // Bare imports inside packages/api-client would otherwise resolve
      // upwards from packages/, which finds the root npm workspace's copies
      // (React 19, a second @tanstack/react-query whose QueryClient context the
      // app's provider never fills) or nothing at all. Always use this app's.
      dedupe: ["react", "react-dom", "@tanstack/react-query", "zod"],
    },
    appType: "spa",
    server: {
      host: "0.0.0.0",
      port: 3000,
      proxy,
      // The dev server only serves files under the workspace root by default.
      fs: { allow: [searchForWorkspaceRoot(process.cwd()), apiClientSrc] },
    },
    build: {
      assetsDir: "assets",
      emptyOutDir: true,
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/setupTests.ts",
      // e2e/ is the Playwright suite, run by its own runner against a live stack.
      exclude: [...configDefaults.exclude, "e2e/**"],
      css: true,
      // lodash-es ships ~650 one-function ES modules, so every test file that
      // imports it had Node resolve, stat and load all of them. Across a
      // parallel run that costs 1-4 s per file. Pre-bundling it into a single
      // module brings that down to ~0.1 s.
      deps: { optimizer: { client: { enabled: true, include: ["lodash-es"] } } },
      reporters: ["verbose"],
      coverage: {
        reporter: ["text", "json", "html"],
        include: ["src/**/*"],
        exclude: [],
      },
    },
  };
});
