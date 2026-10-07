import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: { port: 8001 },
  plugins: [tsconfigPaths({ projects: ["."] }), tanstackStart(), viteReact()],
  ssr: { external: ["sharp", "exiftool-vendored"] },
});
