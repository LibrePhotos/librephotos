import { Text } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageLoader } from "../../common/PageLoader";
import { CropOverlay } from "../crop/CropOverlay";
import type { Recipe } from "../engine/recipe";
import type { ViewMode } from "../engine/renderer";
import classes from "./EditorStage.module.css";
import { SplitDivider } from "./SplitDivider";
import type { usePreview } from "./usePreview";
import { useStageGestures } from "./useStageGestures";
import { FIT, type ZoomState } from "./viewMath";
import { ZoomReadout } from "./ZoomReadout";

/** Room around the picture for the crop frame's handles, in CSS pixels. */
const CROP_MARGIN = 28;
/** Room around the fitted picture otherwise, in CSS pixels. */
const FIT_MARGIN = 12;

type Props = Readonly<{
  preview: ReturnType<typeof usePreview>;
  /** Where the preview's canvas goes (usePreview draws on it). */
  canvasRef: (canvas: HTMLCanvasElement | null) => void;
  recipe: Recipe;
  mode: ViewMode;
  /** The split view's divider (mode `split`), as a fraction of the width, and its change. */
  split: number;
  onSplitChange: (split: number) => void;
  /** The crop tool: the full frame, fitted, with the crop frame over it. */
  cropActive: boolean;
}>;

/**
 * The canvas area: the preview sized to it (CSS size times the device pixel ratio), fitted by
 * default, zoomed with the wheel or a pinch and panned by dragging, with a zoom readout. A loader
 * covers it until the first frame is drawn; a lost GPU context says so until it comes back.
 */
export function EditorStage({ preview, canvasRef, recipe, mode, split, onSplitChange, cropActive }: Props) {
  const { t } = useTranslation();
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<ZoomState>(FIT);
  const [pixelRatio, setPixelRatio] = useState(1);
  const [cssSize, setCssSize] = useState({ width: 0, height: 0 });
  const { request, drawn, status } = preview;

  // The crop tool always starts fitted.
  const [cropShown, setCropShown] = useState(cropActive);
  if (cropShown !== cropActive) {
    setCropShown(cropActive);
    setZoom(FIT);
  }

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setCssSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      setPixelRatio(window.devicePixelRatio || 1);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const canvasElement = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasElement.current;
    if (!canvas) return;
    const width = Math.max(1, Math.round(cssSize.width * pixelRatio));
    const height = Math.max(1, Math.round(cssSize.height * pixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    request({
      recipe,
      mode,
      split,
      zoom,
      fullFrame: cropActive,
      margin: (cropActive ? CROP_MARGIN : FIT_MARGIN) * pixelRatio,
    });
  }, [cssSize, pixelRatio, recipe, mode, split, zoom, cropActive, request, status]);

  const onDoubleClick = useStageGestures({ stage, drawn, pixelRatio, locked: cropActive, onZoom: setZoom });

  return (
    <div
      ref={stage}
      className={classes.stage}
      onDoubleClick={onDoubleClick}
      data-zoomed={zoom.kind === "manual" || undefined}
    >
      <canvas
        className={classes.canvas}
        ref={element => {
          canvasElement.current = element;
          canvasRef(element);
        }}
        aria-label={t("editor.canvas")}
        role="img"
      />
      {cropActive && drawn?.fullFrame && <CropOverlay frame={drawn} pixelRatio={pixelRatio} />}
      {!cropActive && drawn && <ZoomReadout drawn={drawn} onZoom={setZoom} />}
      {mode === "split" && drawn && (
        <SplitDivider split={split} onChange={onSplitChange} width={cssSize.width} height={cssSize.height} />
      )}
      {drawn === null && (status === "starting" || status === "ready") && (
        <div className={classes.cover}>
          <PageLoader />
        </div>
      )}
      {status === "lost" && (
        <div className={classes.notice} role="status">
          <Text size="sm">{t("editor.contextLost")}</Text>
        </div>
      )}
      {(status === "unsupported" || status === "failed") && (
        <div className={classes.cover} role="alert">
          <Text size="sm" ta="center" maw={360} px="md">
            {status === "unsupported" ? t("editor.unsupported.long") : t("editor.renderFailed")}
          </Text>
        </div>
      )}
    </div>
  );
}
