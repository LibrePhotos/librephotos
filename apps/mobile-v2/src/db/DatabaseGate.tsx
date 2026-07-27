/**
 * Opens the SQLite database, applies migrations (with the wipe-and-reseed
 * fallback), and only then renders the app behind a DbProvider. Mounted inside
 * the authenticated area so the mirror is always migrated before any live query
 * runs. The expo-sqlite change listener is bridged to the provider's reactive
 * `subscribe` contract here.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { addDatabaseChangeListener, type SQLiteDatabase } from "expo-sqlite";
import { isInteracting } from "@/sync/activity";
import { useTheme } from "@/theme";
import { openDb } from "./client";
import { runMigrations } from "./migrate";
import { DbProvider, type DbChangeSubscribe } from "./provider";
import type { AppDatabase } from "./types";

/**
 * Bridge expo-sqlite's change events to the provider's `subscribe` contract.
 *
 * This is `sqlite3_update_hook` underneath, so it fires once per changed ROW.
 * The table name is forwarded so the hub can skip queries that do not read it;
 * the coalescing itself happens in db/live-query, not here.
 */
function makeSubscribe(_sqlite: SQLiteDatabase): DbChangeSubscribe {
  return (listener) => {
    const sub = addDatabaseChangeListener((event) => listener(event.tableName));
    return () => sub.remove();
  };
}

export function DatabaseGate({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const [ready, setReady] = useState(false);
  const handle = useRef<{ db: AppDatabase; subscribe: DbChangeSubscribe } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { db, sqlite } = openDb();
      await runMigrations(db, sqlite);
      if (!active) return;
      handle.current = { db, subscribe: makeSubscribe(sqlite) };
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!ready || !handle.current) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.background }}>
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  return (
    // `defer` holds live-query re-runs back while the user is mid-gesture: a
    // background write must not reflow the list under a scrolling finger. The
    // hub caps how long it will wait, so progress still shows either way.
    <DbProvider db={handle.current.db} subscribe={handle.current.subscribe} defer={isInteracting}>
      {children}
    </DbProvider>
  );
}
