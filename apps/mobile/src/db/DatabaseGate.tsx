/**
 * Opens the SQLite database, applies migrations (with the wipe-and-rebuild
 * fallback), warms the timeline's first reads, and only then renders the app
 * behind a DbProvider. Mounted inside the authenticated area so the mirror is
 * always migrated before any live query runs. The expo-sqlite change listener is
 * bridged to the provider's `subscribe` contract here.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import type { QueryClient } from "@tanstack/react-query";
import { addDatabaseChangeListener } from "expo-sqlite";
import { runMigrations, type AppDatabase } from "@librephotos/local-db";
import { isScrolling } from "@/sync/activity";
import { useTheme } from "@/theme";
import { prefetchTimeline } from "@/features/timeline/useMirrorTimeline";
import { useTimelineFilterStore } from "@/features/timeline/timelineFilter";
import { openDb } from "./client";
import { createLiveQueryClient, DbProvider, type DbChangeSubscribe } from "./provider";

/**
 * Bridge expo-sqlite's change events to the provider's `subscribe` contract.
 *
 * This is `sqlite3_update_hook` underneath, so it fires once per changed ROW.
 * The table name is forwarded so the hub can skip queries that do not read it;
 * the coalescing itself happens in the change hub, not here.
 */
const subscribe: DbChangeSubscribe = (listener) => {
  const sub = addDatabaseChangeListener((event) => listener(event.tableName));
  return () => sub.remove();
};

/** How long the gate waits for the warm-up reads before it shows the app anyway. */
const WARM_UP_BUDGET_MS = 1_500;

type Ready = { db: AppDatabase; queries: QueryClient };

export function DatabaseGate({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [ready, setReady] = useState<Ready | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { db, executor } = await openDb();
      await runMigrations(executor, {
        onWipe: (err) => console.warn("[db] migration failed, wiping and rebuilding the mirror", err),
      });
      // The timeline is the first screen: read its first page and day buckets
      // now, so it paints rows in its first frame instead of an empty one.
      const queries = createLiveQueryClient();
      const warm = prefetchTimeline(queries, db, useTimelineFilterStore.getState().filter);
      await Promise.race([warm, new Promise((resolve) => setTimeout(resolve, WARM_UP_BUDGET_MS))]);
      if (active) setReady({ db, queries });
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  return (
    // `defer` holds live-query re-runs back while the user is *scrolling*: a
    // background write must not reflow the list under their finger. Deliberately
    // scroll rather than any touch — a tap that favourites a photo is itself a
    // write, and deferring that flush would leave the user's own action
    // un-reflected. The hub caps the wait, so progress still shows either way.
    <DbProvider db={ready.db} subscribe={subscribe} defer={isScrolling} queries={ready.queries}>
      {children}
    </DbProvider>
  );
}
