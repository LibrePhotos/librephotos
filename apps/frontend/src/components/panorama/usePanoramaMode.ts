import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { notification } from "../../service/notifications";
import { canShowPhotoSphere } from "./photoSphere";

export type PanoramaMode = {
  /** The photo is a 360° photo sphere: the toggle is shown. */
  available: boolean;
  /** Why the toggle cannot be used (no WebGL); undefined when it can. */
  blockedReason: string | undefined;
  /** The photo is shown in the 360° viewer instead of flat. */
  active: boolean;
  toggle: () => void;
  exit: () => void;
  /** The viewer could not show the photo: back to flat, with a toast. */
  fail: () => void;
};

type Args = {
  /** Whether the photo shown is a photo sphere. */
  sphere: boolean;
  /** Changes with the photo shown: every photo opens flat. */
  photoKey: string;
};

/**
 * The "360° view" toggle of the lightbox and the photo page (#483). Photos always open flat, so
 * browsing never downloads a sphere's original unasked; the viewer loads it once the toggle is on.
 */
export function usePanoramaMode({ sphere, photoKey }: Args): PanoramaMode {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
  }, [photoKey]);

  const blockedReason = sphere && !canShowPhotoSphere() ? t("lightbox.panorama.nowebgl") : undefined;
  const usable = sphere && blockedReason === undefined;
  const toggle = useCallback(() => {
    if (usable) setActive(shown => !shown);
  }, [usable]);
  const exit = useCallback(() => setActive(false), []);
  const fail = useCallback(() => {
    setActive(false);
    notification.error(t("lightbox.panorama.loadfailed"));
  }, [t]);

  return { available: sphere, blockedReason, active: active && usable, toggle, exit, fail };
}
