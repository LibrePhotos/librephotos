import { ActionIcon, Group, Tooltip } from "@mantine/core";
import { IconX as X, IconZoomIn as ZoomIn, IconZoomOut as ZoomOut } from "@tabler/icons-react";
import React from "react";
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
}: LightboxControlsProps) {
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
          <Tooltip label="Zoom (Z)" position="bottom" withArrow>
            <ActionIcon variant="subtle" color="gray" onClick={toggleZoom}>
              {isZoomed ? <ZoomOut /> : <ZoomIn />}
            </ActionIcon>
          </Tooltip>
        </div>
      )}
      <div style={{ marginBottom: 5 }}>
        <Tooltip label="Close (Escape)" position="bottom" withArrow>
          <ActionIcon variant="subtle" color="gray" onClick={onCloseRequest}>
            <X />
          </ActionIcon>
        </Tooltip>
      </div>
    </Group>
  );
}
