import react from "@vitejs/plugin-react-swc";
import viteTsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'

export default defineConfig({
  base: "/",
  plugins: [react(), viteTsconfigPaths(), TanStackRouterVite({target: "react", autoCodeSplitting: true})],
  server: {
    host: "0.0.0.0",
    port: 3000,
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
});
