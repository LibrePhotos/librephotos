/**
 * Drizzle DB context + reactive query hook. Components read synced entities
 * through `useReactiveQuery`, which re-runs its query whenever the database
 * commits a change — the "live query" contract from doc 01. The change
 * subscription is injected (expo-sqlite's addDatabaseChangeListener in the app,
 * a manual emitter in tests) so screens stay decoupled from expo-sqlite and are
 * testable against the Node driver.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { AppDatabase } from "./types";

export type DbChangeSubscribe = (listener: () => void) => () => void;

type DbContextValue = { db: AppDatabase; subscribe: DbChangeSubscribe };

const DbContext = createContext<DbContextValue | null>(null);

export function DbProvider({
  db,
  subscribe,
  children,
}: {
  db: AppDatabase;
  subscribe: DbChangeSubscribe;
  children: ReactNode;
}) {
  const ref = useRef<DbContextValue>({ db, subscribe });
  ref.current = { db, subscribe };
  return <DbContext.Provider value={ref.current}>{children}</DbContext.Provider>;
}

export function useDb(): AppDatabase {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useDb must be used within a DbProvider");
  return ctx.db;
}

/**
 * Run a synchronous query and re-run it on every DB change commit. `deps`
 * re-runs when query inputs (e.g. an album id) change. Query results are read
 * synchronously (expo-sqlite + better-sqlite3 are both sync drivers).
 */
export function useReactiveQuery<T>(runner: (db: AppDatabase) => T, deps: readonly unknown[] = []): T {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useReactiveQuery must be used within a DbProvider");
  const { db, subscribe } = ctx;
  const runnerRef = useRef(runner);
  runnerRef.current = runner;

  const [value, setValue] = useState<T>(() => runner(db));

  useEffect(() => {
    let active = true;
    const rerun = () => {
      if (active) setValue(runnerRef.current(db));
    };
    rerun(); // reflect deps/data changes immediately
    const unsubscribe = subscribe(rerun);
    return () => {
      active = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, subscribe, ...deps]);

  return value;
}
