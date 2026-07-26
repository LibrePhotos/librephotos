/**
 * Backup tab (doc 03 §5). All state is read from SQLite via live queries so the
 * screen updates as the sync engine writes: overall queue status, the global
 * toggles (enable / wifi-only / charging-only), the per-album selection list
 * with counts, and the live upload queue. Actions lazily import sync/run (which
 * pulls expo native modules) on press, keeping the static module graph
 * test-friendly — same pattern as the Sync status screen.
 */
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useDb, useReactiveQuery } from "@/db/provider";
import { useAuthStore } from "@/stores/auth";
import { useSyncStore } from "@/stores/sync";
import { useTheme } from "@/theme";
import {
  cycleAlbumSelection,
  getBackupConfig,
  listBackupAlbums,
  setAlbumBackupSelection,
  setBackupConfig,
  type AlbumBackupRow,
  type BackupConfig,
} from "@/db/queries/backup";
import { queueList, queueSummary, retryFailed, type QueueListRow, type QueueSummary } from "@/sync/upload/queue";
import { backupState, type BackupBlocker, type BackupStage, type BackupState } from "@/sync/upload/status";
import { getMediaAccess } from "@/sync/device/media-store";
import { LIBRARY_ALBUM_ID } from "@/sync/device/media-sync";
import type { MediaAccess } from "@/sync/device/types";

const SELECTION_LABEL = ["selectionNone", "selectionSelected", "selectionExcluded"] as const;
const SELECTION_COLOR = ["#9ca3af", "#22c55e", "#dc2626"];

const STATE_LABEL: Record<string, string> = {
  pending: "statePending",
  checking: "stateChecking",
  uploading: "stateUploading",
  done: "stateDone",
  failed: "stateFailed",
  skipped_exists: "stateSkipped",
};

export function BackupScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const db = useDb();
  const userId = useAuthStore((s) => s.userId);
  const running = useSyncStore((s) => s.running);
  const deviceProgress = useSyncStore((s) => s.deviceProgress);
  const gate = useSyncStore((s) => s.gate);

  const config = useReactiveQuery<BackupConfig>((d) => getBackupConfig(d), []);
  const summary = useReactiveQuery<QueueSummary>((d) => queueSummary(d), []);
  const albums = useReactiveQuery<AlbumBackupRow[]>((d) => listBackupAlbums(d), []);
  const queue = useReactiveQuery<QueueListRow[]>((d) => queueList(d, 100), []);
  const access = useReactiveQuery<MediaAccess | null>((d) => getMediaAccess(d), []);
  const state = useReactiveQuery<BackupState>(
    (d) => backupState(d, { config: getBackupConfig(d), access: getMediaAccess(d), gate }),
    [gate]
  );

  const [busy, setBusy] = useState(false);

  const onToggleEnabled = useCallback(
    (value: boolean) => {
      setBackupConfig(db, { enabled: value });
      if (value) void backupNow(db, userId, setBusy);
    },
    [db, userId]
  );

  const onBackupNow = useCallback(() => backupNow(db, userId, setBusy), [db, userId]);

  const onRetry = useCallback(() => {
    retryFailed(db);
    void backupNow(db, userId, setBusy);
  }, [db, userId]);

  const onCycleAlbum = useCallback(
    (album: AlbumBackupRow) => {
      const next = cycleAlbumSelection(album.backup_selection);
      setAlbumBackupSelection(db, album.id, next);
      // Picking an album *is* the user asking for it to be backed up. The
      // master toggle defaults to off, so on the device run selecting an album
      // did precisely nothing and said nothing about why. Turning backup on
      // with the first selection (the toggle stays available to turn it back
      // off) makes the choice mean what it looks like it means.
      if (next === 1 && !getBackupConfig(db).enabled) {
        setBackupConfig(db, { enabled: true });
      }
      if (next === 1) void backupNow(db, userId, setBusy);
    },
    [db, userId]
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
        <Text testID="backup-title" style={{ fontSize: 22, fontWeight: "700", color: theme.text }}>
          {t("backup.title")}
        </Text>

        {/* Overall status. Three lines, in this order and never collapsed:
            what stage is running, how far each pipeline has got, and what (if
            anything) is blocking. An idle queue must never be silent. */}
        <View style={{ gap: 4 }}>
          <Text testID="backup-stage" style={{ color: theme.text, fontSize: 14, fontWeight: "600" }}>
            {deviceProgress
              ? t("backup.statusScanning", {
                  scanned: deviceProgress.scanned,
                  total: Math.max(deviceProgress.total, deviceProgress.scanned),
                })
              : stageText(t, state.stage)}
          </Text>
          {state.counts.selected > 0 ? (
            <Text testID="backup-stage-detail" style={{ color: theme.muted, fontSize: 12 }}>
              {t("backup.hashProgress", { done: state.counts.hashed, total: state.counts.selected })}
              {" · "}
              {t("backup.uploadProgress", {
                done: state.queue.done + state.queue.skipped_exists,
                total: Math.max(state.queue.total, state.queue.done + state.queue.skipped_exists),
              })}
            </Text>
          ) : null}
          {state.blocker ? (
            <Text testID="backup-blocker" style={{ color: "#d97706", fontSize: 12 }}>
              {blockerText(t, state.blocker)}
            </Text>
          ) : null}
        </View>

        <Text testID="backup-summary" style={{ color: theme.muted, fontSize: 13 }}>
          {t("backup.summary", {
            done: summary.done + summary.skipped_exists,
            pending: summary.pending + summary.checking + summary.uploading,
            failed: summary.failed,
          })}
        </Text>

        {access === "limited" ? (
          <Text testID="backup-limited-note" style={{ color: "#d97706", fontSize: 12 }}>
            {t("backup.limitedAccess")}
          </Text>
        ) : null}

        {/* Global toggles */}
        <View style={{ gap: 10 }}>
          <ToggleRow
            testID="backup-enabled-toggle"
            label={config.enabled ? t("backup.enabled") : t("backup.enable")}
            value={config.enabled}
            onValueChange={onToggleEnabled}
            theme={theme}
          />
          <ToggleRow
            testID="backup-wifi-toggle"
            label={t("backup.wifiOnly")}
            value={config.wifiOnly}
            onValueChange={(v) => setBackupConfig(db, { wifiOnly: v })}
            theme={theme}
          />
          <ToggleRow
            testID="backup-charging-toggle"
            label={t("backup.chargingOnly")}
            value={config.chargingOnly}
            onValueChange={(v) => setBackupConfig(db, { chargingOnly: v })}
            theme={theme}
          />
        </View>

        {/* Actions */}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <ActionButton
            testID="backup-now-button"
            label={t("backup.backUpNow")}
            onPress={onBackupNow}
            disabled={busy || running || !config.enabled}
            theme={theme}
          />
          {summary.failed > 0 ? (
            <ActionButton
              testID="backup-retry-button"
              label={t("backup.retryFailed")}
              onPress={onRetry}
              disabled={busy || running}
              theme={theme}
            />
          ) : null}
        </View>

        {/* Album selection list */}
        <View style={{ gap: 8 }}>
          <Text style={{ fontWeight: "600", color: theme.text }}>{t("backup.albums")}</Text>
          {albums.length === 0 ? (
            <Text testID="backup-no-albums" style={{ color: theme.muted, fontSize: 12 }}>
              {t("backup.noAlbums")}
            </Text>
          ) : (
            albums.map((album) => (
              <Pressable
                key={album.id}
                testID={`backup-album-${album.id}`}
                onPress={() => onCycleAlbum(album)}
                style={{
                  borderColor: theme.border,
                  borderWidth: 1,
                  borderRadius: 8,
                  padding: 10,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: theme.text, fontWeight: "600" }} numberOfLines={1}>
                    {album.id === LIBRARY_ALBUM_ID ? t("backup.allPhotos") : (album.title ?? album.id)}
                  </Text>
                  {/* Each number against its own, fixed denominator. The old
                      "on_server/hashed" fraction had a denominator that grew
                      with hashing, so "0/161" of 2867 photos looked done. */}
                  <Text testID={`backup-album-counts-${album.id}`} style={{ color: theme.muted, fontSize: 11 }}>
                    {t("backup.albumCounts", {
                      total: album.linked,
                      hashed: album.hashed,
                      onServer: album.on_server,
                    })}
                  </Text>
                </View>
                <Text
                  testID={`backup-album-selection-${album.id}`}
                  style={{ color: SELECTION_COLOR[album.backup_selection] ?? theme.muted, fontWeight: "600", fontSize: 12 }}
                >
                  {t(`backup.${SELECTION_LABEL[album.backup_selection] ?? "selectionNone"}`)}
                </Text>
              </Pressable>
            ))
          )}
        </View>

        {/* Upload queue */}
        <View style={{ gap: 6 }}>
          <Text style={{ fontWeight: "600", color: theme.text }}>{t("backup.queue")}</Text>
          {queue.length === 0 ? (
            <Text testID="backup-queue-empty" style={{ color: theme.muted, fontSize: 12 }}>
              {t("backup.queueEmpty")}
            </Text>
          ) : (
            queue.map((row) => (
              <View
                key={row.asset_id}
                testID={`backup-queue-${row.asset_id}`}
                style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}
              >
                <Text style={{ color: theme.text, fontSize: 12, flex: 1 }} numberOfLines={1}>
                  {row.name ?? row.asset_id}
                </Text>
                <Text
                  style={{
                    color: row.state === "failed" ? "#dc2626" : theme.muted,
                    fontSize: 11,
                    marginLeft: 8,
                  }}
                >
                  {row.state === "uploading"
                    ? `${Math.round(row.progress * 100)}%`
                    : t(`backup.${STATE_LABEL[row.state] ?? "statePending"}`)}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The headline: which stage is running, and how far along it is. */
function stageText(t: Translate, stage: BackupStage): string {
  switch (stage.kind) {
    case "hashing":
      return t("backup.statusHashing", { done: stage.done, total: stage.total });
    case "uploading":
      return t("backup.statusUploading", { done: stage.done, total: stage.total });
    case "waiting":
      return t("backup.statusWaiting", { count: stage.pending });
    case "up_to_date":
      return t("backup.statusUpToDate", { count: stage.total });
    case "idle":
    default:
      return t("backup.statusIdle");
  }
}

/** Why nothing is moving. Never null-rendered while a blocker exists. */
function blockerText(t: Translate, blocker: BackupBlocker): string {
  switch (blocker.kind) {
    case "no_access":
      return t("backup.blockerNoAccess");
    case "disabled":
      return t("backup.blockerDisabled");
    case "no_selection":
      return t("backup.blockerNoSelection");
    case "offline":
      return t("backup.blockerOffline");
    case "wifi_required":
      return t("backup.blockerWifi");
    case "charging_required":
      return t("backup.blockerCharging");
    case "failed":
    default:
      return t("backup.blockerFailed", { count: blocker.count });
  }
}

async function backupNow(
  db: Parameters<typeof queueSummary>[0],
  userId: number | null,
  setBusy: (b: boolean) => void
): Promise<void> {
  setBusy(true);
  try {
    const { runBackupNow } = await import("@/sync/run");
    await runBackupNow(db, userId);
  } catch (err) {
    // A rejected run must surface, not vanish into an unhandled rejection —
    // "nothing happened and nothing said why" is the bug this screen exists to
    // avoid.
    useSyncStore.getState().setError(err instanceof Error ? err.message : String(err));
  } finally {
    setBusy(false);
  }
}

function ToggleRow({
  label,
  value,
  onValueChange,
  theme,
  testID,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  theme: ReturnType<typeof useTheme>;
  testID?: string;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
      <Text style={{ color: theme.text }}>{label}</Text>
      <Switch testID={testID} value={value} onValueChange={onValueChange} />
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  theme,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  theme: ReturnType<typeof useTheme>;
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
      <Text style={{ color: theme.text, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
