import { ActionIcon, Group, RingProgress, Select, Tooltip } from "@mantine/core";
import {
  IconArrowsMaximize as Maximize,
  IconArrowsMinimize as Minimize,
  IconPlayerPause as Pause,
  IconPlayerPlay as Play,
  IconX as X,
  IconZoomIn as ZoomIn,
  IconZoomOut as ZoomOut,
} from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { LightboxControlsProps } from "./lightbox.types";
import { Toolbar } from "./Toolbar";

// Interval options for slideshow
const INTERVAL_OPTIONS = [
  { value: "3", label: "3s" },
  { value: "5", label: "5s" },
  { value: "10", label: "10s" },
  { value: "15", label: "15s" },
  { value: "30", label: "30s" },
];

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
  isSlideshowActive,
  toggleSlideshow,
  slideshowInterval,
  setSlideshowInterval,
  slideshowProgress,
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
      {/* Slideshow controls */}
      <Group gap={4} style={{ marginBottom: 5 }}>
        {isSlideshowActive && (
          <Select
            size="xs"
            value={slideshowInterval.toString()}
            onChange={value => setSlideshowInterval(parseInt(value || "5", 10))}
            data={INTERVAL_OPTIONS}
            styles={{
              input: {
                width: 56,
                minHeight: 28,
                height: 28,
                backgroundColor: "transparent",
                border: "1px solid rgba(255,255,255,0.2)",
                color: "white",
                fontSize: 12,
                paddingLeft: 8,
                paddingRight: 24,
              },
              dropdown: {
                backgroundColor: "rgba(0,0,0,0.9)",
                border: "1px solid rgba(255,255,255,0.2)",
              },
              option: {
                color: "white",
                fontSize: 12,
                "&[data-selected]": {
                  backgroundColor: "rgba(255,255,255,0.1)",
                },
                "&[data-hovered]": {
                  backgroundColor: "rgba(255,255,255,0.05)",
                },
              },
            }}
            comboboxProps={{ withinPortal: false }}
            withCheckIcon={false}
          />
        )}
        <Tooltip
          label={isSlideshowActive ? t("lightbox.controls.stopslideshow") : t("lightbox.controls.slideshow")}
          position="bottom"
          withArrow
        >
          <div
            style={{
              position: "relative",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {isSlideshowActive && (
              <RingProgress
                size={36}
                thickness={2}
                sections={[{ value: slideshowProgress, color: "blue" }]}
                style={{
                  position: "absolute",
                  inset: 0,
                }}
                rootColor="rgba(255,255,255,0.2)"
              />
            )}
            <ActionIcon
              variant="subtle"
              color={isSlideshowActive ? "blue" : "gray"}
              onClick={toggleSlideshow}
              size={28}
              style={{ zIndex: 1 }}
            >
              {isSlideshowActive ? <Pause size={18} /> : <Play size={18} />}
            </ActionIcon>
          </div>
        </Tooltip>
      </Group>
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
