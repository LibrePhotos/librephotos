import { ActionIcon, Group, Tooltip } from "@mantine/core";
import {
  IconArrowsMaximize as Maximize,
  IconArrowsMinimize as Minimize,
  IconX as X,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { LightboxControlsProps } from "./lightbox.types";
import { Toolbar } from "./Toolbar";

export function LightboxControls({
  photoDetail,
  isPhotoDetailsLoading,
  lightboxSidebarShow,
  setLightBoxSidebarShow,
  isPublic,
  enableZoom,
  type,
  isZoomed,
  toggleZoom,
  onCloseRequest,
  isFullscreen,
  toggleFullscreen,
}: LightboxControlsProps) {
  const { t } = useTranslation();

  return (
    <Group justify="flex-end" style={{ background: "transparent" }}>
      <Toolbar
        photosDetail={photoDetail}
        isPhotoDetailsLoading={isPhotoDetailsLoading}
        lightboxSidebarShow={lightboxSidebarShow}
        closeSidepanel={() => setLightBoxSidebarShow(!lightboxSidebarShow)}
        isPublic={isPublic}
      />
      {enableZoom && type === "photo" && (
        <div style={{ marginBottom: 5 }}>
          <Tooltip label={t("lightbox.controls.zoom")} position="bottom" withArrow>
            <ActionIcon variant="subtle" color="gray" onClick={toggleZoom}>
              {isZoomed ? <ZoomOut /> : <ZoomIn />}
            </ActionIcon>
          </Tooltip>
        </div>
      )}
      <div style={{ marginBottom: 5 }}>
        <Tooltip
          label={isFullscreen ? t("lightbox.controls.exitfullscreen") : t("lightbox.controls.fullscreen")}
          position="bottom"
          withArrow
        >
          <ActionIcon variant="subtle" color="gray" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize /> : <Maximize />}
          </ActionIcon>
        </Tooltip>
      </div>
      <div style={{ marginBottom: 5 }}>
        <Tooltip label={t("lightbox.controls.close")} position="bottom" withArrow>
          <ActionIcon variant="subtle" color="gray" onClick={onCloseRequest}>
            <X />
          </ActionIcon>
        </Tooltip>
      </div>
    </Group>
  );
}
