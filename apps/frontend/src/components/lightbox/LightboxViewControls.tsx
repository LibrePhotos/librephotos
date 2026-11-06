import { ActionIcon } from "@mantine/core";
import {
  IconTextRecognition as TextRecognition,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
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
  canZoom: boolean;
  isZoomed: boolean;
  toggleZoom: () => void;
  /** A photo sphere's 360° view toggle; absent for a flat photo. */
  panorama?: PanoramaMode;
}>;

/**
 * The toolbar's view buttons: 360° view and live text, which show only for a photo that has them,
 * and zoom. Copy, fullscreen and the slideshow are in the ⋮ menu.
 */
export function LightboxViewControls(props: Props) {
  const { t } = useTranslation();
  const { hasOcrText, showOcrText, toggleOcrText, canZoom, isZoomed, toggleZoom } = props;
  const liveTextLabel = showOcrText ? t("lightbox.controls.livetextoff") : t("lightbox.controls.livetext");
  // In the 360° view live text and zoom stay where they are, so the toolbar does not shift under
  // the pointer, but say why they do nothing: the sphere zooms itself.
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
      {canZoom && (
        <DisabledReason
          reason={inPanorama && t("lightbox.panorama.zoominviewer")}
          label={t("lightbox.controls.zoom")}
          position="bottom"
        >
          <ActionIcon
            {...TOOLBAR_BUTTON}
            onClick={toggleZoom}
            aria-label={t("lightbox.controls.zoom")}
            // Only zoom keeps one label, so only it reports its state here;
            // the other toggles say theirs in the label, and both would be
            // read out twice.
            aria-pressed={isZoomed}
          >
            {isZoomed ? <ZoomOut size={TOOLBAR_ICON_SIZE} /> : <ZoomIn size={TOOLBAR_ICON_SIZE} />}
          </ActionIcon>
        </DisabledReason>
      )}
    </>
  );
}
