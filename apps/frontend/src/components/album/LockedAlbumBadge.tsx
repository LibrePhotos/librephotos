import { Badge } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./LockedAlbumBadge.module.css";

/** "Locked" after a locked album's title (#2208): why its photos cannot be added or removed. */
export function LockedAlbumBadge() {
  const { t } = useTranslation();
  return (
    <Badge color="gray" variant="light" size="sm" className={classes.badge} leftSection={<IconLock size={12} />}>
      {t("useralbum.locked")}
    </Badge>
  );
}
