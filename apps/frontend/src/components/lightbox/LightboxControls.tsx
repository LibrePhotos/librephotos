import { ActionIcon, Group } from "@mantine/core";
import { IconX as X, IconZoomIn as ZoomIn, IconZoomOut as ZoomOut } from "@tabler/icons-react";
import React from "react";

import type { LightboxControlsProps } from "./lightbox.types";
import { Toolbar } from "./Toolbar";

export function LightboxControls({
  photoDetail,
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
        lightboxSidebarShow={lightboxSidebarShow}
        closeSidepanel={() => setLightBoxSidebarShow(!lightboxSidebarShow)}
        isPublic={isPublic}
      />
      {enableZoom && type === "photo" && (
        <div style={{ marginBottom: 5 }}>
          <ActionIcon variant="subtle" color="gray" onClick={toggleZoom}>
            {isZoomed ? <ZoomOut /> : <ZoomIn />}
          </ActionIcon>
        </div>
      )}
      <div style={{ marginBottom: 5 }}>
        <ActionIcon variant="subtle" color="gray" onClick={onCloseRequest}>
          <X />
        </ActionIcon>
      </div>
    </Group>
  );
}