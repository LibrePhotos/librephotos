import { useInterval } from "@mantine/hooks";
import { useEffect, useState } from "react";
import { useScreenWakeLock } from "../../hooks/useScreenWakeLock";
import { STORAGE_KEYS, useStoredState } from "../../util/storage";
import {
  DEFAULT_WALL_DISPLAY_SETTINGS,
  DRIFT_EVERY_MS,
  inSleepWindow,
  randomDriftOffset,
  WallDisplaySettings,
  type DriftOffset,
} from "./wallDisplay";

const SCHEDULE_TICK_MS = 30_000;

export function useWallDisplay(active: boolean) {
  const [settings, updateSettings] = useStoredState(
    STORAGE_KEYS.lightboxWallDisplay,
    WallDisplaySettings,
    DEFAULT_WALL_DISPLAY_SETTINGS
  );
  const [now, setNow] = useState(() => new Date());
  useInterval(() => setNow(new Date()), SCHEDULE_TICK_MS, { autoInvoke: true });

  const sleeping = active && settings.sleepEnabled && inSleepWindow(now, settings.sleepStart, settings.sleepEnd);
  const drifting = active && settings.burnInProtection && !sleeping;
  const hideCursor = active && settings.hideCursor;

  const [drift, setDrift] = useState<DriftOffset>({ x: 0, y: 0 });
  useEffect(() => {
    if (!drifting) return undefined;
    const timer = setInterval(() => setDrift(randomDriftOffset()), DRIFT_EVERY_MS);
    return () => clearInterval(timer);
  }, [drifting]);

  useScreenWakeLock(active && settings.keepAwake && !sleeping);

  return { settings, updateSettings, sleeping, drifting, drift, hideCursor };
}
