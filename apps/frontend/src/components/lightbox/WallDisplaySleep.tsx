import { Text, UnstyledButton } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatClockTime } from "../../util/dateUtils";
import classes from "./WallDisplaySleep.module.css";

const SLEEP_HINT_MS = 4_000;

type Props = Readonly<{
  onWake: () => void;
  wakeAt: string;
}>;

export function WallDisplaySleep({ onWake, wakeAt }: Props) {
  const { t } = useTranslation();
  const [hinting, setHinting] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const showHint = () => {
    setHinting(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setHinting(false), SLEEP_HINT_MS);
  };

  return (
    <UnstyledButton
      className={classes.sleep}
      data-hint={hinting || undefined}
      aria-label={t("lightbox.walldisplay.wake")}
      onClick={onWake}
      onPointerMove={showHint}
      onTouchStart={showHint}
    >
      <Text c="gray.6" size="sm" className={classes.hint} aria-hidden>
        {t("lightbox.walldisplay.sleepinghint", { time: formatClockTime(wakeAt) })}
      </Text>
    </UnstyledButton>
  );
}
