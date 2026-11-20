import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiClientSrc = fileURLToPath(new URL("../../packages/api-client/src", import.meta.url));
const localDb = fileURLToPath(new URL("../../packages/local-db", import.meta.url));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: [
      { find: /^@librephotos\/api-client\/core$/, replacement: `${apiClientSrc}/core.ts` },
      { find: /^@librephotos\/local-db$/, replacement: `${localDb}/src/index.ts` },
    ],
    dedupe: ["zod", "drizzle-orm"],
  },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] }, fs: { allow: [".", apiClientSrc, localDb] } },
  build: { target: "es2023", sourcemap: false },
});
