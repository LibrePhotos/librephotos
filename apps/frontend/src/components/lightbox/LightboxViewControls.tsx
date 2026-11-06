import { ActionIcon } from "@mantine/core";
import { IconTextRecognition as TextRecognition } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import { PanoramaToggle } from "../panorama/PanoramaToggle";
import type { PanoramaMode } from "../panorama/usePanoramaMode";
import { TOOLBAR_BUTTON, TOOLBAR_ICON_SIZE } from "./LightboxToolbarButton";

type Props = Readonly<{
  hasOcrText: boolean;
  showOcrText: boolean;
  toggleOcrText: () => void;
  /** A photo sphere's 360° view toggle; absent for a flat photo. */
  panorama?: PanoramaMode;
}>;

/**
 * The toolbar's view buttons: 360° view and live text, which show only for a photo that has them.
 * Zoom (Z, a double click), copy, fullscreen and the slideshow are in the ⋮ menu.
 */
export function LightboxViewControls(props: Props) {
  const { t } = useTranslation();
  const { hasOcrText, showOcrText, toggleOcrText } = props;
  const liveTextLabel = showOcrText ? t("lightbox.controls.livetextoff") : t("lightbox.controls.livetext");
  // In the 360° view live text stays where it is, so the toolbar does not shift under the pointer,
  // but says why it does nothing.
  const inPanorama = !!props.panorama?.active;
  return (
    <>
      {props.panorama && <PanoramaToggle panorama={props.panorama} look="toolbar" />}
      {hasOcrText && (
        <DisabledReason reason={inPanorama && t("lightbox.panorama.notext")} label={liveTextLabel} position="bottom">
          <ActionIcon
            {...TOOLBAR_BUTTON}
            mod={{ active: showOcrText }}
            onClick={toggleOcrText}
            aria-label={liveTextLabel}
          >
            <TextRecognition size={TOOLBAR_ICON_SIZE} />
          </ActionIcon>
        </DisabledReason>
      )}
    </>
  );
}
