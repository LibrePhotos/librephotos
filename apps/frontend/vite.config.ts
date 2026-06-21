import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const publicUrl = env.PUBLIC_URL || env.VITE_PUBLIC_URL || '/';
  
  return {
    base: publicUrl,
    plugins: [tanstackRouter({target: "react", autoCodeSplitting: true}), react()],
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
