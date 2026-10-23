import { ApiError, type InstallState } from "@librephotos/api-client";
import { Alert, Button, Group, Loader, Progress, Stack, Text } from "@mantine/core";
import { IconDownload as Download, IconRefresh as Restart } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useInstallUpdateMutation, useRestartToUpdateMutation } from "../../api_client/server";
import { formatFileSize } from "../../util/fileSize";
import { installFailureKey } from "./updateInstallText";

type PanelProps = Readonly<{ install: InstallState; version: string; latest: string }>;

/** Download update, after a failure with why it failed. */
function DownloadControls({ install, latest }: PanelProps) {
  const { t } = useTranslation();
  const download = useInstallUpdateMutation();
  const failed = install.state === "failed";
  return (
    <Stack gap="xs">
      {failed ? (
        <Alert color="red" variant="light">
          {t("updates.install.failed", { reason: t(installFailureKey(install.error), { code: install.error ?? "" }) })}
        </Alert>
      ) : null}
      <Group gap="xs">
        <Button
          leftSection={<Download size={16} />}
          onClick={() => download.mutate(latest)}
          loading={download.isPending}
        >
          {failed ? t("updates.install.retry") : t("updates.install.download")}
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        {t("updates.install.downloadhint", { version: latest })}
      </Text>
    </Stack>
  );
}

/** Downloading with its progress, then checking and unpacking. */
function InstallProgress({ install, version }: PanelProps) {
  const { t, i18n } = useTranslation();
  const total = install.total_bytes;
  const received = formatFileSize(install.received_bytes, i18n.language);
  let label = t("updates.install.extracting", { version });
  if (install.state === "downloading") {
    label = total
      ? t("updates.install.downloading", { version, received, total: formatFileSize(total, i18n.language) })
      : t("updates.install.downloadingunsized", { version, received });
  } else if (install.state === "verifying") {
    label = t("updates.install.verifying");
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

/** Restart to update; while a job runs the server asks first, and Restart anyway goes on. */
function RestartControls({ install, version }: PanelProps) {
  const { t } = useTranslation();
  const restart = useRestartToUpdateMutation({ reportsErrors: true });
  const jobRunning = jobRunningMessage(restart.error);
  return (
    <Stack gap="xs">
      <Text size="sm">{t("updates.install.ready", { version })}</Text>
      {install.error ? (
        <Alert color="red" variant="light">
          {t("updates.install.failed", { reason: t(installFailureKey(install.error), { code: install.error }) })}
        </Alert>
      ) : null}
      {jobRunning ? (
        <Alert color="yellow" variant="light">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">{jobRunning}</Text>
            <Button size="xs" color="yellow" onClick={() => restart.mutate(true)} loading={restart.isPending}>
              {t("updates.install.restartanyway")}
            </Button>
          </Stack>
        </Alert>
      ) : (
        <Group gap="xs">
          <Button leftSection={<Restart size={16} />} onClick={() => restart.mutate(false)} loading={restart.isPending}>
            {t("updates.install.restart")}
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

function RestartingNotice({ version }: PanelProps) {
  const { t } = useTranslation();
  return (
    <Group gap="xs" wrap="nowrap">
      <Loader size="xs" />
      <Text size="sm">{t("updates.install.restarting", { version })}</Text>
    </Group>
  );
}

const VIEWS: Partial<Record<string, (props: PanelProps) => React.ReactNode>> = {
  downloading: InstallProgress,
  verifying: InstallProgress,
  extracting: InstallProgress,
  ready: RestartControls,
  restarting: RestartingNotice,
};

/**
 * The Windows app's built-in updater on the Update available card (#2788): Download update, its
 * progress, then Restart to update. A state a later server adds shows Download update.
 */
export function UpdateInstallPanel({ install, latest }: Readonly<{ install: InstallState; latest: string }>) {
  const View = VIEWS[install.state] ?? DownloadControls;
  return <View install={install} version={install.version ?? latest} latest={latest} />;
}
