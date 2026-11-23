import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, QueryClient, useQuery, type Query } from "@tanstack/react-query";
import { createChangeHub, type AppDatabase, type ChangeHub, type DbChangeSubscribe } from "@librephotos/local-db";

export type { DbChangeSubscribe };

type DbContextValue = { db: AppDatabase; hub: ChangeHub; queries: QueryClient };

const DbContext = createContext<DbContextValue | null>(null);

const LIVE_QUERY_ROOT = "local-db";

const LIVE_QUERY_GC_MS = 10 * 60_000;

export type ReactiveQueryKey = readonly [string, ...unknown[]];

export function liveQueryKey(key: ReactiveQueryKey): readonly unknown[] {
  return [LIVE_QUERY_ROOT, ...key];
}

export function createLiveQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        networkMode: "always",
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

export function useLiveQueryClient(): QueryClient {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useLiveQueryClient must be used within a DbProvider");
  return ctx.queries;
}

type Read<T> = { promise: Promise<T> };

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
  tables?: readonly string[];
  keepPrevious?: boolean;
};

export type ReactiveQueryResult<T> = {
  data: T;
  loading: boolean;
  error: Error | null;
};

export function useReactiveQuery<T>(
  key: ReactiveQueryKey,
  run: (db: AppDatabase) => Promise<T>,
  placeholder: T,
  options: ReactiveQueryOptions = {}
): ReactiveQueryResult<T> {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error("useReactiveQuery must be used within a DbProvider");
  const { db, queries } = ctx;
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
