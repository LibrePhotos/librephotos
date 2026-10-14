import { ActionIcon, Divider, Group, Tooltip } from "@mantine/core";
import {
  IconCopy as Copy,
  IconArrowsMaximize as Maximize,
  IconArrowsMinimize as Minimize,
  IconTextRecognition as TextRecognition,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";

type Props = Readonly<{
  hasOcrText: boolean;
  showOcrText: boolean;
  toggleOcrText: () => void;
  canZoom: boolean;
  isZoomed: boolean;
  toggleZoom: () => void;
  /** Absent where copy cannot work, and on a phone, where it is in the actions menu. */
  onCopyToClipboard?: () => void;
  isCopyingToClipboard: boolean;
  copyLabel: string;
  /** False on a phone, where fullscreen is in the actions menu. */
  showFullscreen: boolean;
  isFullscreen: boolean;
  toggleFullscreen: () => void;
  fullscreenLabel: string;
}>;

/** Group 2 of the lightbox toolbar: live text, zoom, copy and fullscreen. */
export function LightboxViewControls(props: Props) {
  const { t } = useTranslation();
  const { hasOcrText, showOcrText, toggleOcrText, canZoom, isZoomed, toggleZoom } = props;
  const { onCopyToClipboard, isCopyingToClipboard, copyLabel } = props;
  const { showFullscreen, isFullscreen, toggleFullscreen, fullscreenLabel } = props;
  const liveTextLabel = showOcrText ? t("lightbox.controls.livetextoff") : t("lightbox.controls.livetext");
  return (
    <>
      <Divider orientation="vertical" color="var(--app-scrim-white-20)" />
      <Group gap={4} align="center">
        {hasOcrText && (
          <Tooltip label={liveTextLabel} position="bottom" withArrow>
            <ActionIcon
              variant="subtle"
              color={showOcrText ? "blue" : "gray"}
              onClick={toggleOcrText}
              size={28}
              aria-label={liveTextLabel}
            >
              <TextRecognition size={ICON_SIZE.lightbox} />
            </ActionIcon>
          </Tooltip>
        )}
        {canZoom && (
          <Tooltip label={t("lightbox.controls.zoom")} position="bottom" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={toggleZoom}
              size={28}
              aria-label={t("lightbox.controls.zoom")}
              // Only zoom keeps one label, so only it reports its state here;
              // the other toggles say theirs in the label, and both would be
              // read out twice.
              aria-pressed={isZoomed}
            >
              {isZoomed ? <ZoomOut size={ICON_SIZE.lightbox} /> : <ZoomIn size={ICON_SIZE.lightbox} />}
            </ActionIcon>
          </Tooltip>
        )}
        {onCopyToClipboard && (
          <Tooltip label={copyLabel} position="bottom" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              onClick={onCopyToClipboard}
              loading={isCopyingToClipboard}
              size={28}
              aria-label={copyLabel}
            >
              <Copy size={ICON_SIZE.lightbox} />
            </ActionIcon>
          </Tooltip>
        )}
        {showFullscreen && (
          <Tooltip label={fullscreenLabel} position="bottom" withArrow>
            <ActionIcon variant="subtle" color="gray" onClick={toggleFullscreen} size={28} aria-label={fullscreenLabel}>
              {isFullscreen ? <Minimize size={ICON_SIZE.lightbox} /> : <Maximize size={ICON_SIZE.lightbox} />}
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    </>
  );
}
