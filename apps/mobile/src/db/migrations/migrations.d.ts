// Types for migrations.js, which `drizzle-kit generate` writes (driver "expo", see
// drizzle.config.ts) and overwrites on every run, so it stays JavaScript and is not
// edited by hand. TypeScript reads this declaration in its place; without it the
// .sql imports in the generated file would be typed `any`. babel-plugin-inline-import
// turns each .sql import into the file's text (babel.config.js), so every migration
// is a string, which is what the expo migrator takes.
import type { migrate } from "drizzle-orm/expo-sqlite/migrator";

declare const bundle: Parameters<typeof migrate>[1];
export default bundle;
