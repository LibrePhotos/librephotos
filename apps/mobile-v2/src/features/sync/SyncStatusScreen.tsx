/**
 * Sync status screen (doc 03 §8) — Settings → Sync status. Shows, live:
 *   - per-entity cursor / last-run / progress table (from sync_state)
 *   - local mirror counts (from the mirror tables)
 *   - a live progress bar for the in-flight run (from the sync UI store)
 *   - the structured sync log (ring buffer), with an "export logs" action
 *   - a "Repair sync" button (wipe + reseed)
 *
 * Everything is read from SQLite via live queries, so the table updates as the
 * sync writes pages. `run.ts` (which imports app singletons) is loaded lazily on
 * button press, keeping this component's static module graph test-friendly.
 */
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useDb, useReactiveQuery } from "@/db/provider";
import { allSyncState, type SyncStateRow } from "@/db/queries/sync-state";
import { recentSyncLog, type SyncLogRow } from "@/db/queries/sync-log";
import { localCounts, type LocalCounts } from "@/db/queries/counts";
import { useAuthStore } from "@/stores/auth";
import { useSyncStore } from "@/stores/sync";
import { useTheme } from "@/theme";

const ENTITY_LABEL: Record<string, string> = {
  photo: "Photos",
  person: "People",
  user_album: "Albums",
  auto_album: "Events",
  thing_album: "Things",
  place_album: "Places",
  tag_album: "Tags",
  sharing: "Sharing",
};

function fmtTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}

export function SyncStatusScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDb();
  const userId = useAuthStore((s) => s.userId);

  const states = useReactiveQuery<SyncStateRow[]>((d) => allSyncState(d), []);
  const logs = useReactiveQuery<SyncLogRow[]>((d) => recentSyncLog(d, 100), []);
  const counts = useReactiveQuery<LocalCounts>((d) => localCounts(d), []);

  const running = useSyncStore((s) => s.running);
  const progress = useSyncStore((s) => s.progress);
  const lastError = useSyncStore((s) => s.lastError);

  const [busy, setBusy] = useState(false);

  const onRepair = useCallback(async () => {
    setBusy(true);
    try {
      const { repair } = await import("@/sync/run");
      await repair(db, userId);
    } finally {
      setBusy(false);
    }
  }, [db, userId]);

  const onSyncNow = useCallback(async () => {
    setBusy(true);
    try {
      const { runSync } = await import("@/sync/run");
      await runSync(db, { userId, reason: "manual" });
    } finally {
      setBusy(false);
    }
  }, [db, userId]);

  const onExport = useCallback(async () => {
    const lines = logs.map(
      (l) =>
        `${fmtTime(l.ts)}\t${l.level}\t${l.op ?? ""}\t${l.entity ?? ""}\t` +
        `applied=${l.applied ?? ""}\tdeleted=${l.deleted ?? ""}\t${l.message ?? ""}`
    );
    const header = "LibrePhotos mobile — sync log export";
    await Share.share({ message: [header, ...lines].join("\n") });
  }, [logs]);

  const byEntity = new Map(states.map((s) => [s.entity, s]));
  const orderedEntities = Object.keys(ENTITY_LABEL);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Text testID="sync-status-title" style={{ fontSize: 22, fontWeight: "700", color: theme.text }}>
          {t("sync.title")}
        </Text>

        {/* Live progress */}
        <View style={{ gap: 6 }}>
          <Text style={{ color: theme.muted, fontSize: 13 }}>
            {running
              ? progress
                ? `${ENTITY_LABEL[progress.entity] ?? progress.entity} · ${progress.current}/${progress.total} · ${progress.phase}`
                : t("sync.running")
              : t("sync.idle")}
          </Text>
          {progress && progress.total > 0 ? (
            <View style={{ height: 6, backgroundColor: theme.border, borderRadius: 3, overflow: "hidden" }}>
              <View
                testID="sync-progress-bar"
                style={{
                  height: 6,
                  width: `${Math.min(100, Math.round((progress.current / progress.total) * 100))}%`,
                  backgroundColor: theme.brand,
                }}
              />
            </View>
          ) : null}
          {lastError ? (
            <Text testID="sync-error" style={{ color: "#dc2626", fontSize: 12 }}>
              {lastError}
            </Text>
          ) : null}
        </View>

        {/* Per-entity table */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontWeight: "600", color: theme.text }}>{t("sync.entities")}</Text>
          {orderedEntities.map((entity) => {
            const s = byEntity.get(entity);
            const countKey = COUNT_FOR_ENTITY[entity];
            const count = countKey ? counts[countKey] : undefined;
            return (
              <View
                key={entity}
                testID={`sync-entity-${entity}`}
                style={{
                  borderColor: theme.border,
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 10,
                  gap: 2,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: theme.text, fontWeight: "600" }}>
                    {ENTITY_LABEL[entity]}
                    {count != null ? `  (${count})` : ""}
                  </Text>
                  <Text style={{ color: theme.muted, fontSize: 12 }}>{s?.status ?? "—"}</Text>
                </View>
                <Text style={{ color: theme.muted, fontSize: 11 }}>
                  {t("sync.lastRun")}: {fmtTime(s?.last_full_sync)} · {t("sync.upTo")}:{" "}
                  {fmtTime(s?.cursor_modified)}
                </Text>
                {s && s.progress_total > 0 && s.status === "running" ? (
                  <Text style={{ color: theme.muted, fontSize: 11 }}>
                    {s.progress_current}/{s.progress_total}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </View>

        {/* Actions */}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <ActionButton testID="sync-now-button" label={t("sync.syncNow")} onPress={onSyncNow} disabled={busy || running} theme={theme} />
          <ActionButton testID="sync-export-button" label={t("sync.exportLogs")} onPress={onExport} disabled={logs.length === 0} theme={theme} />
        </View>
        <ActionButton
          testID="sync-repair-button"
          label={t("sync.repair")}
          onPress={onRepair}
          disabled={busy || running}
          theme={theme}
          danger
        />

        {/* Log list */}
        <View style={{ gap: 6 }}>
          <Text style={{ fontWeight: "600", color: theme.text }}>{t("sync.log")}</Text>
          {logs.length === 0 ? (
            <Text testID="sync-log-empty" style={{ color: theme.muted, fontSize: 12 }}>
              {t("sync.logEmpty")}
            </Text>
          ) : (
            logs.map((l) => (
              <Text
                key={l.id}
                testID={`sync-log-${l.id}`}
                style={{ color: l.level === "error" ? "#dc2626" : theme.muted, fontSize: 11 }}
              >
                {fmtTime(l.ts)} · {l.op ?? ""}
                {l.entity ? `/${l.entity}` : ""} · {l.message ?? ""}
                {l.applied != null ? ` (+${l.applied}${l.deleted ? `/-${l.deleted}` : ""})` : ""}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const COUNT_FOR_ENTITY: Record<string, keyof LocalCounts | undefined> = {
  photo: "photos",
  person: "persons",
  user_album: "user_albums",
  auto_album: "auto_albums",
  thing_album: "thing_albums",
  place_album: "place_albums",
  tag_album: "tags",
  sharing: undefined,
};

function ActionButton({
  label,
  onPress,
  disabled,
  theme,
  danger,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  theme: ReturnType<typeof useTheme>;
  danger?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        opacity: disabled ? 0.5 : 1,
        backgroundColor: theme.card,
        borderColor: theme.border,
        borderWidth: 1,
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: "center",
      }}
    >
      <Text style={{ color: danger ? "#dc2626" : theme.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
