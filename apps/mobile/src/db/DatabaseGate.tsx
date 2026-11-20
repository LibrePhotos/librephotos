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

const subscribe: DbChangeSubscribe = (listener) => {
  const sub = addDatabaseChangeListener((event) => listener(event.tableName));
  return () => sub.remove();
};

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
