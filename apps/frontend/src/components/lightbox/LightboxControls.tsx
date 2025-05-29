import { ActionIcon, Group, Tooltip } from "@mantine/core";
import { IconX as X, IconZoomIn as ZoomIn, IconZoomOut as ZoomOut, IconKeyboard } from "@tabler/icons-react";
import React from "react";

import type { LightboxControlsProps } from "./lightbox.types";
import { Toolbar } from "./Toolbar";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";

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
          <ActionIcon variant="subtle" color="gray" onClick={toggleZoom}>
            {isZoomed ? <ZoomOut /> : <ZoomIn />}
          </ActionIcon>
        </div>
      )}
      <div style={{ marginBottom: 5 }}>
        <Tooltip
          label={
            <div style={{ fontSize: '12px' }}>
              <div><strong>Keyboard Shortcuts:</strong></div>
              <div>← → : Navigate</div>
              <div>Escape : Close</div>
              <div>Z : Zoom</div>
              <div>I : Info panel</div>
              {!isPublic && (
                <>
                  <div>F : Favorite</div>
                  <div>H : Hide</div>
                  <div>P : Public</div>
                </>
              )}
              <div>Space : Play/Pause (video)</div>
            </div>
          }
          position="bottom-end"
          withArrow
        >
          <ActionIcon variant="subtle" color="gray" size="sm">
            <IconKeyboard size={16} />
          </ActionIcon>
        </Tooltip>
      </div>
      <div style={{ marginBottom: 5 }}>
        <ActionIcon variant="subtle" color="gray" onClick={onCloseRequest}>
          <X />
        </ActionIcon>
      </div>
    </Group>
  );
}