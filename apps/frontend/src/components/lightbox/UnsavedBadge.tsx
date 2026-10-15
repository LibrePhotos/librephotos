import { Badge } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

/** Marks an editor whose draft differs from the saved value (#2284): leaving it would ask first. */
export function UnsavedBadge() {
  const { t } = useTranslation();
  return (
    <Badge color="orange" variant="dot" size="sm">
      {t("lightbox.unsaved.badge")}
    </Badge>
  );
}
