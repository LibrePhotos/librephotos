/**
 * Sync status screen (doc 03 §8) — Settings → Sync status. Shows, live:
 *   - the **work queue**: what is running now, how deep each kind is, and every
 *     failure with its own reason
 *   - the **pipeline**: each stage's progress against a real, fixed total
 *   - per-entity cursor / last-run / progress table (from sync_state)
 *   - local mirror counts (from the mirror tables)
 *   - the structured sync log (ring buffer), with an "export logs" action
 *   - a "Repair sync" button (wipe + reseed)
 *
 * The first two sections are the answer to the question the device run could
 * not answer: *which stage is running, how far along is it, and what is
 * blocking it.* Under the old sequential driver none of that was observable —
 * the pipeline's only state was the JS call stack.
 *
 * Everything is read from SQLite via live queries, so the tables update as the
 * worker settles each job. `run.ts` (which imports app singletons) is loaded
 * lazily on button press, keeping this component's static module graph
 * test-friendly.
 */
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useDb, useReactiveQuery } from "@/db/provider";
import { allSyncState, type SyncStateRow } from "@/db/queries/sync-state";
import { recentSyncLog, type SyncLogRow } from "@/db/queries/sync-log";
import { localCounts, type LocalCounts } from "@/db/queries/counts";
import { outboxSummary, type OutboxSummary } from "@/mutations/outbox";
import { useAuthStore } from "@/stores/auth";
import { useSyncStore } from "@/stores/sync";
import { useTheme } from "@/theme";
import { retryFailedJobs } from "@/sync/jobs/queue";
import { jobQueueSnapshot, syncStages, type JobQueueSnapshot, type StageProgress } from "@/sync/jobs/status";
import type { JobKind } from "@/sync/jobs/types";

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

/** Human names for the job kinds, so the queue reads as work, not as enum values. */
const JOB_LABEL_KEY: Record<JobKind, string> = {
  outbox_replay: "sync.jobKindOutboxReplay",
  reseed_check: "sync.jobKindReseedCheck",
  remote_delta: "sync.jobKindRemoteDelta",
  device_scan: "sync.jobKindDeviceScan",
  hash_batch: "sync.jobKindHashBatch",
  upload_asset: "sync.jobKindUploadAsset",
  thumb_prefetch: "sync.jobKindThumbPrefetch",
  integrity_check: "sync.jobKindIntegrityCheck",
};

const STAGE_LABEL_KEY: Record<StageProgress["stage"], string> = {
  remote: "sync.stageRemote",
  scan: "sync.stageScan",
  hash: "sync.stageHash",
  upload: "sync.stageUpload",
  thumbs: "sync.stageThumbs",
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
  const outbox = useReactiveQuery<OutboxSummary>((d) => outboxSummary(d), []);
  const queue = useReactiveQuery<JobQueueSnapshot>((d) => jobQueueSnapshot(d), []);
  const stages = useReactiveQuery<StageProgress[]>((d) => syncStages(d), []);

  const running = useSyncStore((s) => s.running);
  const progress = useSyncStore((s) => s.progress);
  const lastError = useSyncStore((s) => s.lastError);

  const [busy, setBusy] = useState(false);

  const onRetryJobs = useCallback(async () => {
    retryFailedJobs(db);
    setBusy(true);
    try {
      const { runSync } = await import("@/sync/run");
      await runSync(db, { userId, reason: "manual" });
    } finally {
      setBusy(false);
    }
  }, [db, userId]);

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

        {/* Work queue — which stage is running, how deep, and what is stuck.
            This section exists because the old pipeline could answer none of
            those: its only state was the JS call stack, so a stalled run looked
            identical to an idle one. */}
        <View testID="sync-queue" style={{ gap: 6 }}>
          <Text style={{ fontWeight: "600", color: theme.text }}>{t("sync.queue")}</Text>
          <Text testID="sync-queue-depth" style={{ color: theme.muted, fontSize: 12 }}>
            {queue.totals.pending + queue.totals.running === 0 && queue.totals.failed === 0
              ? t("sync.queueIdle")
              : t("sync.queueDepth", {
                  pending: queue.totals.pending,
                  running: queue.totals.running,
                  failed: queue.totals.failed,
                })}
          </Text>

          {/* What is running right now, by name. */}
          {queue.inFlight.map((job) => (
            <Text
              key={job.id}
              testID={`sync-queue-inflight-${job.kind}`}
              style={{ color: theme.text, fontSize: 12 }}
            >
              {t("sync.queueRunning", { kind: t(JOB_LABEL_KEY[job.kind] ?? job.kind) })}
            </Text>
          ))}

          {/* Queue depth per kind, so a backlog is visible before it stalls. */}
          {queue.depth
            .filter((d) => d.pending + d.running > 0)
            .map((d) => (
              <View
                key={d.kind}
                testID={`sync-queue-kind-${d.kind}`}
                style={{ flexDirection: "row", justifyContent: "space-between" }}
              >
                <Text style={{ color: theme.muted, fontSize: 11 }} numberOfLines={1}>
                  {t(JOB_LABEL_KEY[d.kind] ?? d.kind)}
                </Text>
                <Text style={{ color: theme.muted, fontSize: 11 }}>
                  {d.pending + d.running}
                  {d.running > 0 ? " ●" : ""}
                </Text>
              </View>
            ))}

          {/* Failures, each with its own reason — never a silent stall. */}
          {queue.failures.length > 0 ? (
            <View testID="sync-queue-failures" style={{ gap: 2, marginTop: 4 }}>
              <Text style={{ fontWeight: "600", color: theme.text, fontSize: 12 }}>
                {t("sync.queueFailures")}
              </Text>
              {queue.failures.map((f) => (
                <Text
                  key={f.id}
                  testID={`sync-queue-failure-${f.id}`}
                  style={{ color: f.terminal ? "#dc2626" : "#d97706", fontSize: 11 }}
                >
                  {t(JOB_LABEL_KEY[f.kind] ?? f.kind)} · {f.lastError ?? "—"}
                  {f.terminal ? "" : ` · ${t("sync.queueWaiting")}`}
                </Text>
              ))}
              <ActionButton
                testID="sync-queue-retry-button"
                label={t("sync.queueRetry")}
                onPress={onRetryJobs}
                disabled={busy || running || !queue.failures.some((f) => f.terminal)}
                theme={theme}
              />
            </View>
          ) : null}
        </View>

        {/* Pipeline — every stage against its own REAL total. Never a growing
            denominator: the counts come from work that already exists (mirror
            rows, the device's own library count), not from work discovered so
            far. "0/161" of a 2867-photo library is the bug this prevents. */}
        <View testID="sync-stages" style={{ gap: 6 }}>
          <Text style={{ fontWeight: "600", color: theme.text }}>{t("sync.stages")}</Text>
          {stages.map((stage) => (
            <View key={stage.stage} testID={`sync-stage-${stage.stage}`} style={{ gap: 2 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.text, fontSize: 12, fontWeight: stage.active ? "700" : "400" }}>
                  {t(STAGE_LABEL_KEY[stage.stage])}
                  {stage.active ? " ●" : ""}
                </Text>
                <Text testID={`sync-stage-progress-${stage.stage}`} style={{ color: theme.muted, fontSize: 12 }}>
                  {(stage.total === 0
                    ? t("sync.stageNothing")
                    : t("sync.stageProgress", { done: stage.done, total: stage.total })) +
                    (stage.stuck > 0 ? ` · ${t("sync.stageStuck", { count: stage.stuck })}` : "")}
                </Text>
              </View>
              {stage.total > 0 ? (
                <View
                  style={{ height: 4, backgroundColor: theme.border, borderRadius: 2, overflow: "hidden" }}
                >
                  <View
                    testID={`sync-stage-bar-${stage.stage}`}
                    style={{
                      height: 4,
                      width: `${Math.min(100, Math.round((stage.done / stage.total) * 100))}%`,
                      backgroundColor: theme.brand,
                    }}
                  />
                </View>
              ) : null}
            </View>
          ))}
        </View>

        {/* Offline outbox (pending mutations) */}
        <View testID="sync-outbox" style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontWeight: "600", color: theme.text }}>{t("sync.outbox")}</Text>
            {outbox.total > 0 ? (
              <View
                testID="outbox-badge"
                style={{ backgroundColor: theme.brand, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}
              >
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{outbox.total}</Text>
              </View>
            ) : null}
          </View>
          <Text testID="outbox-summary" style={{ color: theme.muted, fontSize: 12 }}>
            {outbox.total === 0
              ? t("sync.allSynced")
              : t("sync.pendingCount", { count: outbox.total }) +
                (outbox.failed > 0 ? ` · ${t("backup.stateFailed")}: ${outbox.failed}` : "")}
          </Text>
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
