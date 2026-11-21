import type { ParallelWorkers, WorkerIntention, WorkerPlan } from "@librephotos/api-client";
import { Alert, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useParallelWorkersQuery, useSetWorkerIntentionMutation } from "../../api_client/server";
import { ICON_SIZE } from "../../uiConstants";

const INTENTIONS: readonly WorkerIntention[] = ["gentle", "balanced", "fast"];

function isIntention(value: string): value is WorkerIntention {
  return INTENTIONS.some(intention => intention === value);
}

function gigabytes(megabytes: number): string {
  return (megabytes / 1024).toFixed(1);
}

type SourceKey = "sitesettings.workers_source_cgroup" | "sitesettings.workers_source_job";

function sourceKey(source: string): SourceKey | null {
  if (source.startsWith("cgroup")) return "sitesettings.workers_source_cgroup";
  if (source === "job object") return "sitesettings.workers_source_job";
  return null;
}

function PlanLines({ plan, status }: Readonly<{ plan: WorkerPlan; status: ParallelWorkers }>) {
  const { t } = useTranslation();
  const memory = { needed: gigabytes(plan.needed_mb), budget: gigabytes(plan.budget_mb) };
  return (
    <Stack gap={4}>
      <Text fz="sm" role="status">
        {t("sitesettings.workers_result", { count: plan.workers, ...memory })}
      </Text>
      {plan.limited_by === "memory" && plan.fits ? (
        <Text fz="xs" c="dimmed">
          {t("sitesettings.workers_limited_memory")}
        </Text>
      ) : null}
      {plan.limited_by === "database" ? (
        <Text fz="xs" c="dimmed">
          {t("sitesettings.workers_limited_database")}
        </Text>
      ) : null}
      {plan.fits ? null : (
        <Alert color="orange" variant="light" icon={<IconAlertTriangle size={ICON_SIZE.inline} aria-hidden />}>
          {t("sitesettings.workers_too_small", { needed: memory.needed, budget: memory.budget })}
        </Alert>
      )}
      {status.override === null ? null : (
        <Text fz="xs" c="dimmed">
          {t("sitesettings.workers_override", { count: status.override })}
        </Text>
      )}
    </Stack>
  );
}

function RunningLine({ status }: Readonly<{ status: ParallelWorkers }>) {
  const { t } = useTranslation();
  if (status.workers.length === 0) return null;
  const active = status.workers.filter(worker => worker.active).length;
  const recycles = status.workers.reduce((sum, worker) => sum + worker.memory_recycles, 0);
  return (
    <Text fz="xs" c="dimmed">
      {t("sitesettings.workers_running", { active, total: status.workers.length, recycles })}
    </Text>
  );
}

export function ParallelWorkersSetting({ showRunning = true }: Readonly<{ showRunning?: boolean }>) {
  const { t } = useTranslation();
  const { data: status } = useParallelWorkersQuery({ enabled: true });
  const setIntention = useSetWorkerIntentionMutation();
  if (!status) return null;
  const chosen = isIntention(status.intention) ? status.intention : "balanced";
  const plan = status.plans.find(candidate => candidate.intention === chosen);
  const source = sourceKey(status.capacity.ram_source);
  return (
    <Stack gap="xs">
      <Text fz="sm" fw={500} id="parallel-workers-label">
        {t("sitesettings.workers")}
      </Text>
      <Text fz={13} c="dimmed" maw="72ch">
        {t("sitesettings.workers_description")}
      </Text>
      <Text fz="sm">
        {t("sitesettings.workers_detected", {
          cores: status.capacity.cores,
          memory: gigabytes(status.capacity.ram_total_mb),
          available: gigabytes(status.capacity.ram_available_mb),
          source: source ? t(source) : "",
        })}
      </Text>
      <SegmentedControl
        aria-labelledby="parallel-workers-label"
        value={chosen}
        onChange={value => {
          if (isIntention(value)) setIntention.mutate(value);
        }}
        disabled={setIntention.isPending}
        data={INTENTIONS.map(intention => ({ value: intention, label: t(`sitesettings.workers_${intention}`) }))}
      />
      <Text fz="xs" c="dimmed">
        {t(`sitesettings.workers_${chosen}_description`)}
      </Text>
      {plan ? <PlanLines plan={plan} status={status} /> : null}
      {showRunning ? <RunningLine status={status} /> : null}
    </Stack>
  );
}
