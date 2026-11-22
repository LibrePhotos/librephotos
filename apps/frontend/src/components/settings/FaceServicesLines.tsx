import type { ParallelWorkers, WorkerPlan } from "@librephotos/api-client";
import { Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

function gigabytes(megabytes: number): string {
  return (megabytes / 1024).toFixed(1);
}

function LimitNote({ plan }: Readonly<{ plan: WorkerPlan }>) {
  const { t } = useTranslation();
  if (plan.face_replicas >= plan.heavy_workers) return null;
  const lanes = plan.heavy_workers;
  switch (plan.face_limited_by) {
    case "memory":
      return (
        <Text fz="xs" c="dimmed">
          {t("sitesettings.workers_faces_limited_memory", { lanes })}
        </Text>
      );
    case "vram":
      return (
        <Text fz="xs" c="dimmed">
          {t("sitesettings.workers_faces_limited_vram", { lanes, budget: gigabytes(plan.vram_budget_mb ?? 0) })}
        </Text>
      );
    case "gpu":
      return (
        <Text fz="xs" c="dimmed">
          {t("sitesettings.workers_faces_limited_gpu")}
        </Text>
      );
    default:
      return null;
  }
}

export function FaceServicesLines({ plan, status }: Readonly<{ plan: WorkerPlan; status: ParallelWorkers }>) {
  const { t } = useTranslation();
  if (plan.face_replicas === 0) return null;
  const memory = gigabytes(plan.face_replica_mb);
  const wanted = status.face_override;
  return (
    <>
      <Text fz="sm">
        {plan.face_vram_mb > 0
          ? t("sitesettings.workers_faces_gpu", {
              count: plan.face_replicas,
              memory,
              vram: gigabytes(plan.face_vram_mb),
            })
          : t("sitesettings.workers_faces", { count: plan.face_replicas, memory })}
      </Text>
      <LimitNote plan={plan} />
      {wanted !== null && wanted > plan.face_replicas ? (
        <Text fz="xs" c="dimmed">
          {t("sitesettings.workers_faces_override", { wanted, count: plan.face_replicas })}
        </Text>
      ) : null}
    </>
  );
}

export function FaceServicesRunning({ status }: Readonly<{ status: ParallelWorkers }>) {
  const { t } = useTranslation();
  const services = status.face_services;
  if (services.running === 0) return null;
  const memory = gigabytes(services.rss_mb.reduce((sum, size) => sum + size, 0));
  return (
    <Text fz="xs" c="dimmed">
      {t("sitesettings.workers_faces_running", { count: services.running, memory })}
    </Text>
  );
}
