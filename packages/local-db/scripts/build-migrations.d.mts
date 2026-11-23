export type BuiltMigration = { tag: string; statements: string[] };
export function buildMigrations(migrationsDir?: string): BuiltMigration[];
export function render(migrations: BuiltMigration[]): string;
