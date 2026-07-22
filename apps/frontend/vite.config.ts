import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
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

  return {
    base: publicUrl,
    plugins: [
      tanstackRouter({target: "react", autoCodeSplitting: true}),
      react(wdyr ? { jsxImportSource: "@welldone-software/why-did-you-render" } : {}),
    ],
    appType: 'spa',
    server: {
      host: "0.0.0.0",
      port: 3000,
    },
    build: {
      assetsDir: 'assets',
      emptyOutDir: true,
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: "./src/setupTests.ts",
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
