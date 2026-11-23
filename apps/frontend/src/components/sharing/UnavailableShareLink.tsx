import { Box } from "@mantine/core";
import { IconAlertCircle, IconClockX } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../common/EmptyState";

export function UnavailableShareLink({ expired }: Readonly<{ expired: boolean }>) {
  const { t } = useTranslation();
  const Icon = expired ? IconClockX : IconAlertCircle;
  return (
    <Box px="md">
      <EmptyState
        icon={<Icon size={40} />}
        title={expired ? t("publicphoto.expired") : t("publicphoto.notFound")}
        description={expired ? t("publicphoto.expiredHint") : t("publicalbum.checkUrl")}
        actionLabel={t("publicalbum.goHome")}
        actionLink="/"
      />
    </Box>
  );
}
