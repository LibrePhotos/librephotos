import { Box } from "@mantine/core";
import { IconAlertCircle, IconClockX } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "../common/EmptyState";

type Props = Readonly<{
  subject: "photo" | "album";
  expired?: boolean;
}>;

export function UnavailableShareLink({ subject, expired = false }: Props) {
  const { t } = useTranslation();
  const Icon = expired ? IconClockX : IconAlertCircle;
  const missing = subject === "album" ? t("publicalbum.notFound") : t("publicphoto.notFound");
  return (
    <Box px="md">
      <EmptyState
        icon={<Icon size={40} />}
        title={expired ? t("publicphoto.expired") : missing}
        description={expired ? t("publicphoto.expiredHint") : t("publicalbum.checkUrl")}
        actionLabel={t("publicalbum.goHome")}
        actionLink="/"
      />
    </Box>
  );
}
