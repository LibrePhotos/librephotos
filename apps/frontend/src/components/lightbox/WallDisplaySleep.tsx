import { UnstyledButton } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import classes from "./WallDisplaySleep.module.css";

export function WallDisplaySleep({ onWake }: Readonly<{ onWake: () => void }>) {
  const { t } = useTranslation();
  return <UnstyledButton className={classes.sleep} aria-label={t("lightbox.walldisplay.wake")} onClick={onWake} />;
}
