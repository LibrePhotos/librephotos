import { useDisclosure } from "@mantine/hooks";
import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useScreenWakeLock } from "../../hooks/useScreenWakeLock";
import { STORAGE_KEYS, useStoredState } from "../../util/storage";
import { useSlideshow } from "./useSlideshow";
import {
  CURSOR_IDLE_MS,
  DEFAULT_WALL_DISPLAY_SETTINGS,
  DRIFT_EVERY_MS,
  inSleepWindow,
  randomDriftOffset,
  SLEEP_CHECK_EVERY_MS,
  WallDisplaySettings,
  type DriftOffset,
} from "./wallDisplay";

type SlideshowArgs = Parameters<typeof useSlideshow>[0];

function useSleepWindowCheck(watching: boolean, inWindow: () => boolean) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!watching) return () => {};
      const timer = setInterval(onChange, SLEEP_CHECK_EVERY_MS);
      return () => clearInterval(timer);
    },
    [watching]
  );
  useSyncExternalStore(subscribe, () => watching && inWindow());
}

function useIdleCursor(watching: boolean) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!watching) return undefined;
    let timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS);
    const onMove = () => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), CURSOR_IDLE_MS);
    };
    document.addEventListener("pointermove", onMove);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointermove", onMove);
      setIdle(false);
    };
  }, [watching]);
  return watching && idle;
}

function useDrift(drifting: boolean): CSSProperties | undefined {
  const [drift, setDrift] = useState<DriftOffset>({ x: 0, y: 0 });
  useEffect(() => {
    if (!drifting) return undefined;
    const timer = setInterval(() => setDrift(randomDriftOffset()), DRIFT_EVERY_MS);
    return () => clearInterval(timer);
  }, [drifting]);
  if (!drifting) return undefined;
  return { transform: `translate(${drift.x}px, ${drift.y}px)`, transition: `transform ${DRIFT_EVERY_MS}ms linear` };
}

export function useWallDisplay(slideshowArgs: SlideshowArgs) {
  const [settings, updateSettings] = useStoredState(
    STORAGE_KEYS.lightboxWallDisplay,
    WallDisplaySettings,
    DEFAULT_WALL_DISPLAY_SETTINGS
  );
  const { sleepEnabled, sleepStart, sleepEnd } = settings;
  const inWindow = () => sleepEnabled && inSleepWindow(new Date(), sleepStart, sleepEnd);
  const sleepHours = inWindow();
  const slideshow = useSlideshow({ ...slideshowArgs, held: slideshowArgs.held || sleepHours });
  const active = slideshow.isSlideshowActive;
  const asleep = active && sleepHours;
  useSleepWindowCheck(active && sleepEnabled, inWindow);
  useScreenWakeLock(active && settings.keepAwake);
  const cursorHidden = useIdleCursor(active && settings.hideCursor);
  const stageStyle = useDrift(active && settings.burnInProtection && !asleep);
  const [dialogOpened, { open: openSettings, close: closeSettings }] = useDisclosure(false);
  const { toggleSlideshow } = slideshow;
  const wake = useCallback(() => {
    if (asleep) toggleSlideshow();
  }, [asleep, toggleSlideshow]);

  return {
    slideshow,
    asleep,
    wake,
    stageProps: { "data-hidecursor": cursorHidden || undefined, style: stageStyle },
    openSettings,
    dialog: { opened: dialogOpened, onClose: closeSettings, settings, onChange: updateSettings },
  };
}
