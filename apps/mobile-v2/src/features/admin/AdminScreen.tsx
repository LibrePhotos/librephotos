import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import {
  endpoints,
  useApiClient,
  useJobsQuery,
  useWorkerAvailabilityQuery,
  type Job,
} from "@librephotos/api-client";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToastStore } from "@/stores/toasts";
import { useTheme, type ThemeColors } from "@/theme";

/**
 * Admin-lite server screen (admin users only, doc 05). Read-only job list +
 * worker availability (polled), plus scan / full-rescan triggers. User
 * management stays on the web.
 */
export function AdminScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const client = useApiClient();
  const isOnline = useOnlineStatus();
  const pushToast = useToastStore((s) => s.push);

  const jobs = useJobsQuery({ pageSize: 20, refetchInterval: isOnline ? 5000 : undefined });
  const worker = useWorkerAvailabilityQuery({ refetchInterval: isOnline ? 5000 : undefined, enabled: isOnline });

  const trigger = async (kind: "scan" | "full") => {
    try {
      await (kind === "scan" ? endpoints.scanPhotos(client) : endpoints.fullScanPhotos(client));
      pushToast({ level: "info", message: t("admin.queued") });
      void jobs.refetch();
    } catch {
      pushToast({ level: "error", message: t("common.error") });
    }
  };

  const workerUp = worker.data?.status === true;
  const workerBusy = worker.data?.queue_can_accept_job === false;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
        <Pressable testID="admin-back" onPress={() => router.back()} hitSlop={8}>
          <Text style={{ color: theme.brand, fontSize: 16 }}>‹</Text>
        </Pressable>
        <Text style={{ fontSize: 22, fontWeight: "700", color: theme.text, flex: 1 }}>{t("admin.title")}</Text>
      </View>

      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            testID="worker-indicator"
            style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: workerUp ? (workerBusy ? "#eab308" : "#16a34a") : "#dc2626" }}
          />
          <Text style={{ color: theme.text }}>
            {t("admin.worker")}: {workerUp ? (workerBusy ? t("admin.workerBusy") : t("admin.workerUp")) : t("admin.workerDown")}
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable
            testID="admin-scan"
            disabled={!isOnline}
            onPress={() => void trigger("scan")}
            style={{ backgroundColor: theme.brand, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, opacity: isOnline ? 1 : 0.5 }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>{t("admin.triggerScan")}</Text>
          </Pressable>
          <Pressable
            testID="admin-full-scan"
            disabled={!isOnline}
            onPress={() => void trigger("full")}
            style={{ borderColor: theme.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, opacity: isOnline ? 1 : 0.5 }}
          >
            <Text style={{ color: theme.text, fontWeight: "700" }}>{t("admin.triggerFullScan")}</Text>
          </Pressable>
        </View>
        <Text style={{ color: theme.muted, fontWeight: "600", marginTop: 8 }}>{t("admin.jobs")}</Text>
      </View>

      {jobs.isLoading ? (
        <View testID="admin-loading" style={{ padding: 32, alignItems: "center" }}>
          <ActivityIndicator color={theme.brand} />
        </View>
      ) : (
        <FlatList
          testID="admin-jobs"
          data={jobs.data?.results ?? []}
          keyExtractor={(j) => String(j.id)}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={
            <View testID="admin-jobs-empty" style={{ padding: 24, alignItems: "center" }}>
              <Text style={{ color: theme.muted }}>{t("admin.noJobs")}</Text>
            </View>
          }
          renderItem={({ item }) => <JobRow job={item} theme={theme} t={t} />}
        />
      )}
    </SafeAreaView>
  );
}

function jobStatus(job: Job): { key: string; color: string } {
  if (job.failed) return { key: "failed", color: "#dc2626" };
  if (job.cancelled) return { key: "cancelled", color: "#6b7280" };
  if (job.finished) return { key: "finished", color: "#16a34a" };
  if (job.started_at) return { key: "running", color: "#2563eb" };
  return { key: "queued", color: "#eab308" };
}

function JobRow({ job, theme, t }: { job: Job; theme: ThemeColors; t: (k: string) => string }) {
  const status = jobStatus(job);
  const total = job.progress_target ?? 0;
  const current = job.progress_current ?? 0;
  return (
    <View
      testID={`job-${job.id}`}
      style={{ backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: 10, padding: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontWeight: "600" }} numberOfLines={1}>
          {job.job_type_str}
        </Text>
        {total > 0 && !job.finished ? (
          <Text style={{ color: theme.muted, fontSize: 12 }}>{`${current} / ${total}`}</Text>
        ) : null}
      </View>
      <Text style={{ color: status.color, fontWeight: "700", fontSize: 12 }}>{t(`admin.${status.key}`)}</Text>
    </View>
  );
}
