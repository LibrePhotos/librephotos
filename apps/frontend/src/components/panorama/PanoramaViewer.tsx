import "@photo-sphere-viewer/core/index.css";
import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { DEFAULTS, Viewer, type events } from "@photo-sphere-viewer/core";
import { IconCompass, IconZoomIn, IconZoomOut } from "@tabler/icons-react";
import React, { useEffect, useEffectEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import classes from "./PanoramaViewer.module.css";

export type PanoramaViewerProps = Readonly<{
  /** The equirectangular image: the original where this page may load it, else the big thumbnail. */
  src: string;
  /** What the photo shows, for screen readers. */
  label: string;
  /** The image could not be loaded or drawn. */
  onLoadFailed: () => void;
}>;

/** Whether a key press is typing (the caption editor, a tag input), which must not turn the view. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Photo Sphere Viewer (three.js, WebGL) on one equirectangular photo (#483). Loaded on demand
 * (`LazyPanoramaViewer`): neither it nor three.js is in the main bundle. Drag or swipe to look
 * around, pinch or scroll to zoom; with the keyboard the arrow keys look around and + and - zoom,
 * unless focus is in a text field. Its own toolbar is off: the bar below is Mantine, translated
 * and labelled. No auto-rotation, and no inertia under `prefers-reduced-motion`.
 */
export function PanoramaViewer({ src, label, onLoadFailed }: PanoramaViewerProps) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const reportError = useEffectEvent(onLoadFailed);
  const loadingText = t("lightbox.panorama.loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const created = new Viewer({
      container,
      panorama: src,
      navbar: false,
      keyboard: "always",
      moveInertia: !reducedMotion,
      loadingTxt: loadingText,
    });
    created.addEventListener("panorama-error", () => reportError());
    created.addEventListener("key-press", (event: events.KeypressEvent) => {
      if (isTyping(event.originalEvent.target)) event.preventDefault();
    });
    setViewer(created);
    return () => {
      setViewer(null);
      created.destroy();
    };
  }, [src, reducedMotion, loadingText]);

  // Back to where the photo was taken facing, at the starting zoom; at once, without an animation.
  const faceForward = () => {
    if (!viewer) return;
    viewer.rotate({ yaw: viewer.config.defaultYaw ?? 0, pitch: viewer.config.defaultPitch ?? 0 });
    viewer.zoom(viewer.config.defaultZoomLvl ?? DEFAULTS.defaultZoomLvl);
  };

  return (
    <div className={classes.stage}>
      <div
        ref={containerRef}
        className={classes.canvas}
        role="img"
        aria-roledescription={t("lightbox.panorama.roledescription")}
        aria-label={label}
      />
      <Group gap={4} wrap="nowrap" className={classes.bar}>
        <BarButton label={t("lightbox.panorama.zoomout")} onClick={() => viewer?.zoomOut()}>
          <IconZoomOut size={ICON_SIZE.lightbox} />
        </BarButton>
        <BarButton label={t("lightbox.panorama.zoomin")} onClick={() => viewer?.zoomIn()}>
          <IconZoomIn size={ICON_SIZE.lightbox} />
        </BarButton>
        <BarButton label={t("lightbox.panorama.faceforward")} onClick={faceForward}>
          <IconCompass size={ICON_SIZE.lightbox} />
        </BarButton>
        <Text size="xs" className={classes.hint} visibleFrom="sm">
          {t("lightbox.panorama.hint")}
        </Text>
      </Group>
    </div>
  );
}

function BarButton({
  label,
  onClick,
  children,
}: Readonly<{ label: string; onClick: () => void; children: React.ReactNode }>) {
  return (
    <Tooltip label={label} position="top" withArrow>
      <ActionIcon variant="subtle" color="gray" size={28} radius="xl" aria-label={label} onClick={onClick}>
        {children}
      </ActionIcon>
    </Tooltip>
  );
}
