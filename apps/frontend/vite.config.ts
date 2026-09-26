import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const publicUrl = env.PUBLIC_URL || env.VITE_PUBLIC_URL || '/';

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
    appType: 'spa',
    server: {
      host: "0.0.0.0",
      port: 3000,
      proxy,
    },
    build: {
      assetsDir: 'assets',
      emptyOutDir: true,
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/setupTests.ts",
      // e2e/ is the Playwright suite, run by its own runner against a live stack.
      exclude: [...configDefaults.exclude, "e2e/**"],
      css: true,
      reporters: ["verbose"],
      coverage: {
        reporter: ["text", "json", "html"],
        include: ["src/**/*"],
        exclude: [],
      },
    },
  }
});
