import { ActionIcon } from "@mantine/core";
import { IconView360 } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import { TOOLBAR_BUTTON, TOOLBAR_ICON_SIZE } from "../lightbox/LightboxToolbarButton";
import type { PanoramaMode } from "./usePanoramaMode";

type Props = Readonly<{
  panorama: Pick<PanoramaMode, "active" | "blockedReason" | "toggle">;
  /** The lightbox's dark toolbar, or the photo page's round mat tools. */
  look: "toolbar" | "mat";
}>;

/** Shows a photo sphere in the 360° viewer, or flat again (V). */
export function PanoramaToggle({ panorama, look }: Props) {
  const { t } = useTranslation();
  const toolbar = look === "toolbar";
  // V is the lightbox's shortcut; the photo page has none.
  const label = toolbar ? t("lightbox.panorama.toggle") : t("photopage.panorama");
  return (
    <DisabledReason reason={panorama.blockedReason} label={label} position="bottom">
      <ActionIcon
        {...(toolbar
          ? { ...TOOLBAR_BUTTON, mod: { active: panorama.active } }
          : { variant: panorama.active ? "filled" : "default", size: "lg", radius: "xl" })}
        onClick={panorama.toggle}
        aria-label={label}
        aria-pressed={panorama.active}
      >
        <IconView360 size={toolbar ? TOOLBAR_ICON_SIZE : 18} />
      </ActionIcon>
    </DisabledReason>
  );
}
