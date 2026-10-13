import type { SiteModelDownload } from "@librephotos/api-client";
import { Anchor, Group, Progress, Stack, Text } from "@mantine/core";
import { IconCircleCheck as CircleCheck } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { downloadPercent, type ModelStatus } from "./siteFeatures";

type Props = {
  status: ModelStatus;
  download: SiteModelDownload | null | undefined;
  onRetry: () => void;
  retrying: boolean;
};

function JobLink({ download }: { download: SiteModelDownload }) {
  const { t } = useTranslation();
  return (
    <Anchor
      fz="xs"
      // renderRoot, not component={Link}: only this way are `to` and `params` type-checked
      renderRoot={props => <Link to="/admin/job/$id" params={{ id: String(download.id) }} {...props} />}
    >
      {t("sitesettings.feature_view_job")}
    </Anchor>
  );
}

/** The line under a feature switch about the model it runs on (ready, downloading, failed). */
export function FeatureModelStatus({ status, download, onRetry, retrying }: Props) {
  const { t } = useTranslation();

  if (status === "none") {
    return null;
  }
  if (status === "ready") {
    return (
      <Group gap={4} component="span" wrap="nowrap">
        <CircleCheck size={14} color="var(--mantine-color-teal-6)" aria-hidden />
        <Text span fz="xs" c="dimmed">
          {t("sitesettings.feature_model_ready")}
        </Text>
      </Group>
    );
  }
  if (status === "downloading" && download) {
    const percent = downloadPercent(download);
    return (
      <Stack gap={4} component="span" maw={360}>
        <Group gap="xs" component="span" wrap="nowrap">
          <Text span fz="xs" c="dimmed">
            {t("sitesettings.feature_model_downloading", { percent })}
          </Text>
          <JobLink download={download} />
        </Group>
        <Progress value={percent} size="sm" animated aria-hidden />
      </Stack>
    );
  }
  if (status === "failed" && download) {
    return (
      <Group gap="xs" component="span" wrap="wrap">
        <Text span fz="xs" c="red">
          {t("sitesettings.feature_model_failed")}
        </Text>
        <JobLink download={download} />
        <Anchor component="button" type="button" fz="xs" onClick={onRetry} disabled={retrying}>
          {t("sitesettings.feature_retry")}
        </Anchor>
      </Group>
    );
  }
  return (
    <Text span fz="xs" c="dimmed">
      {t("sitesettings.feature_model_missing")}
    </Text>
  );
}
