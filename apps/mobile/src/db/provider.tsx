/**
 * Database context + reactive (live) queries. Components read synced entities
 * through `useReactiveQuery`, which re-runs its query when the tables it reads
 * change — the "live query" contract from doc 01.
 *
 * Every query is async (@librephotos/local-db over expo-sqlite's async API), so
 * the hook is a TanStack Query observer on a QueryClient of its own, private to
 * this provider:
 *
 * - **cached per key**: a screen that remounts paints its last result in its
 *   first frame and re-reads in the background, so there is no empty flash;
 * - **previous value while re-running**: a re-read after a change keeps the
 *   current data on screen until the new rows arrive (`keepPrevious` extends
 *   that to a key change, e.g. a growing page);
 * - **first-load state**: `loading` is true until there is a result for the
 *   current key, so a screen can tell "still reading" from "empty";
 * - **no stale overwrite**: results are stored per key, and a read that
 *   finishes after a newer read of the same key started answers with the newer
 *   read's result, so an old read can never replace a newer one (TanStack only
 *   cancels an in-flight read once the query has data, not on its first load);
 * - **never paused**: `networkMode: "always"`, the reads are local.
 *
 * The raw change source (expo-sqlite's update hook in the app, a test DB's
 * tracker in tests) is not consumed directly: it fires once per changed ROW,
 * which a camera-roll scan turns into tens of thousands of events. It goes
 * through the coalescing change hub from @librephotos/local-db, which batches
 * those into a few flushes per second scoped to the tables they touched; each
 * flush invalidates the queries that read one of those tables (an active query
 * re-reads, an inactive one is marked stale for its next mount).
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, QueryClient, useQuery, type Query } from "@tanstack/react-query";
import { createChangeHub, type AppDatabase, type ChangeHub, type DbChangeSubscribe } from "@librephotos/local-db";

export type { DbChangeSubscribe };

type DbContextValue = { db: AppDatabase; hub: ChangeHub; queries: QueryClient };

const DbContext = createContext<DbContextValue | null>(null);

/** Root of every live-query key, so nothing else in a client can collide with one. */
const LIVE_QUERY_ROOT = "local-db";

/** How long a result nobody shows stays cached for a screen that comes back. */
const LIVE_QUERY_GC_MS = 10 * 60_000;

/** A live query's identity: a name, then every input its query reads. */
export type ReactiveQueryKey = readonly [string, ...unknown[]];

export function liveQueryKey(key: ReactiveQueryKey): readonly unknown[] {
  return [LIVE_QUERY_ROOT, ...key];
}

/** A QueryClient for local reads only. */
export function createLiveQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
        // Fresh until the change hub says a table it reads changed.
        staleTime: Infinity,
        gcTime: LIVE_QUERY_GC_MS,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

function tablesOf(query: Query): readonly string[] | null {
  const tables = query.meta?.tables;
  if (!Array.isArray(tables)) return null;
  const names = tables.filter((t): t is string => typeof t === "string");
  return names.length === tables.length ? names : null;
}

function touches(want: readonly string[] | null, changed: ReadonlySet<string> | null): boolean {
  if (want == null || changed == null) return true;
  return want.some((t) => changed.has(t));
}

export function DbProvider({
  db,
  subscribe,
  defer,
  queries,
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
  /** The live-query cache; DatabaseGate passes the one it warmed. Created here otherwise. */
  queries?: QueryClient;
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
  const client = useMemo(() => queries ?? createLiveQueryClient(), [queries]);

  useEffect(() => {
    const unwatch = hub.watch(null, (changed) => {
      void client.invalidateQueries({
        queryKey: [LIVE_QUERY_ROOT],
        predicate: (query) => touches(tablesOf(query), changed),
      });
    });
    return () => {
      unwatch();
      hub.close();
    };
  }, [hub, client]);

  const value = useMemo(() => ({ db, hub, queries: client }), [db, hub, client]);
  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

export function useDb(): AppDatabase {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useDb must be used within a DbProvider");
  return ctx.db;
}

/** The live-query cache, to warm or read it outside a component. */
export function useLiveQueryClient(): QueryClient {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useLiveQueryClient must be used within a DbProvider");
  return ctx.queries;
}

type Read<T> = { promise: Promise<T> };

/**
 * Start a read and resolve with the result of the NEWEST read started on this
 * ref, however the reads finish: a slow read that a change superseded hands
 * over to the read that replaced it instead of answering with old rows.
 */
async function newestRead<T>(latest: { current: Read<T> | null }, promise: Promise<T>): Promise<T> {
  const mine: Read<T> = { promise };
  latest.current = mine;
  let current = mine;
  let result = await promise;
  while (latest.current !== null && latest.current !== current) {
    current = latest.current;
    result = await current.promise;
  }
  return result;
}

export type ReactiveQueryOptions = {
  /**
   * The tables the query reads: only writes to them re-run it. Omit it and any
   * change re-runs the query, which is always correct; only ever declare tables
   * you have checked against the query's SQL, since an under-declared list shows
   * stale data.
   */
  tables?: readonly string[];
  /** Keep showing the previous key's result while a new key's first read runs. */
  keepPrevious?: boolean;
};

export type ReactiveQueryResult<T> = {
  data: T;
  /** No result for the current key yet (the first read, or a new key under `keepPrevious`). */
  loading: boolean;
  error: Error | null;
};

/**
 * Run an async query and re-run it when the tables it reads change.
 *
 * `key` names the query and every input it reads (an album id, a filter):
 * results are cached per key, so two queries must never share one, and a value
 * the query reads that is missing from the key means a stale answer. While
 * there is no result yet, `data` is `placeholder` (the first render's value is
 * kept, so an inline `[]` stays one stable array) and `loading` is true.
 */
export function useReactiveQuery<T>(
  key: ReactiveQueryKey,
  run: (db: AppDatabase) => Promise<T>,
  placeholder: T,
  options: ReactiveQueryOptions = {}
): ReactiveQueryResult<T> {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useReactiveQuery must be used within a DbProvider");
  const { db, queries } = ctx;
  // The first render's placeholder, kept: an inline `[]` stays one stable array.
  const [firstPlaceholder] = useState(placeholder);
  const latest = useRef<Read<T> | null>(null);
  const query = useQuery(
    {
      queryKey: liveQueryKey(key),
      queryFn: () => newestRead(latest, run(db)),
      meta: options.tables ? { tables: options.tables } : undefined,
      placeholderData: options.keepPrevious ? keepPreviousData : undefined,
    },
    queries
  );
  return {
    data: query.data ?? firstPlaceholder,
    loading: query.isPending || query.isPlaceholderData,
    error: query.error,
  };
}
