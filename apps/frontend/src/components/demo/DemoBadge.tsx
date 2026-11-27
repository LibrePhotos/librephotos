import { Badge, Tooltip } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDemoSite } from "./useDemoSite";

export function DemoBadge(): React.ReactNode {
  const { t } = useTranslation();
  const demo = useDemoSite();
  if (!demo) return null;
  return (
    <Tooltip label={t("demoSite.badgeHint")} multiline w={260}>
      <Badge variant="light" size="lg" tabIndex={0} flex="0 0 auto">
        {t("demoSite.badge")}
      </Badge>
    </Tooltip>
  );
}
