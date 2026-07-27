/**
 * Drizzle DB context + reactive query hook. Components read synced entities
 * through `useReactiveQuery`, which re-runs its query when the database changes
 * — the "live query" contract from doc 01.
 *
 * The raw change source is injected (expo-sqlite's `addDatabaseChangeListener`
 * in the app, a manual emitter in tests) so screens stay decoupled from
 * expo-sqlite and are testable against the Node driver. It is *not* consumed
 * directly: it fires once per changed ROW, which a camera-roll scan turns into
 * tens of thousands of events. Everything goes through the coalescing hub in
 * ./live-query, which batches those into a few flushes per second and can scope
 * them to the tables a query actually reads. See that module for why coalescing
 * cannot drop the final update.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createChangeHub, type ChangeHub, type DbChangeSubscribe } from "./live-query";
import type { AppDatabase } from "./types";

export type { DbChangeSubscribe };

type DbContextValue = { db: AppDatabase; hub: ChangeHub };

const DbContext = createContext<DbContextValue | null>(null);

export function DbProvider({
  db,
  subscribe,
  defer,
  children,
}: {
  db: AppDatabase;
  subscribe: DbChangeSubscribe;
  /**
   * Returns true while the user is mid-gesture. Flushes are held back for the
   * duration (bounded), so a background scan cannot reflow a list under a
   * scrolling finger.
   */
  defer?: () => boolean;
  children: ReactNode;
}) {
  // `defer` is read through a ref so an inline arrow in the caller does not tear
  // the hub down and rebuild it on every render.
  const deferRef = useRef(defer);
  deferRef.current = defer;

  const hub = useMemo(
    () => createChangeHub({ subscribe, defer: () => deferRef.current?.() === true }),
    [subscribe]
  );
  useEffect(() => () => hub.close(), [hub]);

  const value = useMemo(() => ({ db, hub }), [db, hub]);
  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): AppDatabase {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useDb must be used within a DbProvider");
  return ctx.db;
}

/**
 * Run a synchronous query and re-run it when the database changes. `deps`
 * re-runs when query inputs (e.g. an album id) change. Results are read
 * synchronously (expo-sqlite + better-sqlite3 are both sync drivers).
 *
 * `tables` is an optional optimisation: name the tables the query reads and it
 * will not be woken by writes to anything else. Omit it and the query is woken
 * by every change, which is always correct — only ever declare tables you have
 * checked against the query's SQL, since an under-declared list shows stale data.
 */
export function useReactiveQuery<T>(
  runner: (db: AppDatabase) => T,
  deps: readonly unknown[] = [],
  tables?: readonly string[]
): T {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useReactiveQuery must be used within a DbProvider");
  const { db, hub } = ctx;
  const runnerRef = useRef(runner);
  runnerRef.current = runner;

  const [value, setValue] = useState<T>(() => runner(db));

  // Stable identity for an inline `["a", "b"]` literal, so the subscription is
  // not torn down and rebuilt on every render.
  const tableKey = tables ? tables.join(",") : "";

  useEffect(() => {
    let active = true;
    const rerun = () => {
      if (active) setValue(runnerRef.current(db));
    };
    rerun(); // reflect deps/data changes immediately
    const unwatch = hub.watch(tableKey === "" ? null : tableKey.split(","), rerun);
    return () => {
      active = false;
      unwatch();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, hub, tableKey, ...deps]);

  return value;
}
