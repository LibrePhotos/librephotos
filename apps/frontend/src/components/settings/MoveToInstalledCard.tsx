import { ApiError, type InstallState, type UpdateStatus } from "@librephotos/api-client";
import { Alert, Button, Group, Loader, Progress, Stack, Text } from "@mantine/core";
import { IconPackage as Package, IconRefresh as Restart } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useMoveToInstalledMutation, useRestartToUpdateMutation } from "../../api_client/server";
import { formatFileSize } from "../../util/fileSize";
import { NoticeCard } from "../common/NoticeCard";
import { installFailureKey } from "./updateInstallText";

type StepProps = Readonly<{ install: InstallState; version: string }>;

function StartMove({ install, version }: StepProps) {
  const { t } = useTranslation();
  const move = useMoveToInstalledMutation();
  const failed = install.kind === "move" && install.state === "failed";
  return (
    <Stack gap="xs">
      {failed ? (
        <Alert color="red" variant="light">
          {t("updates.move.failed", { reason: t(installFailureKey(install.error), { code: install.error ?? "" }) })}
        </Alert>
      ) : null}
      <Group gap="xs">
        <Button leftSection={<Package size={16} />} onClick={() => move.mutate()} loading={move.isPending}>
          {failed ? t("updates.install.retry") : t("updates.move.start")}
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        {t("updates.move.hint", { version })}
      </Text>
    </Stack>
  );
}

function MoveProgress({ install }: StepProps) {
  const { t, i18n } = useTranslation();
  const total = install.total_bytes;
  const received = formatFileSize(install.received_bytes, i18n.language);
  let label = t("updates.move.verifying");
  if (install.state === "downloading") {
    label = total
      ? t("updates.move.downloading", { received, total: formatFileSize(total, i18n.language) })
      : t("updates.move.downloadingunsized", { received });
  }
  const sized = install.state === "downloading" && Boolean(total);
  const value = sized && total ? Math.min(100, Math.round((install.received_bytes * 100) / total)) : 100;
  return (
    <Stack gap={4}>
      <Text size="sm">{label}</Text>
      <Progress value={value} animated={!sized} striped={!sized} aria-label={label} />
    </Stack>
  );
}

function jobRunningMessage(error: Error | null): string | null {
  return error instanceof ApiError && error.serverCode === "job_running" ? (error.serverMessage ?? null) : null;
}

function FinishMove() {
  const { t } = useTranslation();
  const restart = useRestartToUpdateMutation({ reportsErrors: true });
  const jobRunning = jobRunningMessage(restart.error);
  return (
    <Stack gap="xs">
      <Text size="sm">{t("updates.move.ready")}</Text>
      {jobRunning ? (
        <Alert color="orange" variant="light">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">{jobRunning}</Text>
            <Button size="xs" color="orange" onClick={() => restart.mutate(true)} loading={restart.isPending}>
              {t("updates.install.restartanyway")}
            </Button>
          </Stack>
        </Alert>
      ) : (
        <Group gap="xs">
          <Button leftSection={<Restart size={16} />} onClick={() => restart.mutate(false)} loading={restart.isPending}>
            {t("updates.move.restart")}
          </Button>
        </Group>
      )}
      {restart.error && !jobRunning ? (
        <Text size="sm" c="red">
          {restart.error instanceof ApiError && restart.error.serverMessage
            ? restart.error.serverMessage
            : t("updates.install.failure.restart_failed")}
        </Text>
      ) : null}
    </Stack>
  );
}

function Moving() {
  const { t } = useTranslation();
  return (
    <Group gap="xs" wrap="nowrap">
      <Loader size="xs" />
      <Text size="sm">{t("updates.move.restarting")}</Text>
    </Group>
  );
}

function MoveStep({ install, version }: StepProps) {
  if (install.kind !== "move") {
    return <StartMove install={install} version={version} />;
  }
  if (install.state === "downloading" || install.state === "verifying") {
    return <MoveProgress install={install} version={version} />;
  }
  if (install.state === "ready") {
    return <FinishMove />;
  }
  if (install.state === "restarting") {
    return <Moving />;
  }
  return <StartMove install={install} version={version} />;
}

export function MoveToInstalledCard({ status }: Readonly<{ status: UpdateStatus }>) {
  const { t } = useTranslation();
  if (!status.install) {
    return null;
  }
  return (
    <NoticeCard
      tone="brand"
      icon={<Package size={20} />}
      title={t("updates.move.title")}
      description={t("updates.move.description", { version: status.current })}
    >
      <MoveStep install={status.install} version={status.current} />
    </NoticeCard>
  );
}
