import { ActionIcon } from "@mantine/core";
import { IconView360 } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { DisabledReason } from "../common/DisabledReason";
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
        variant={toolbar ? "subtle" : panorama.active ? "filled" : "default"}
        color={toolbar ? (panorama.active ? "blue" : "gray") : undefined}
        size={toolbar ? 28 : "lg"}
        radius={toolbar ? undefined : "xl"}
        onClick={panorama.toggle}
        aria-label={label}
        aria-pressed={panorama.active}
      >
        <IconView360 size={toolbar ? ICON_SIZE.lightbox : 18} />
      </ActionIcon>
    </DisabledReason>
  );
}
