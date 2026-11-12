import { Text } from "@mantine/core";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSectionOpen } from "../controls/sectionOpen";
import { clippingOf, histogramPath, sharedScale, type HistogramChannel } from "./histogramModel";
import classes from "./HistogramPanel.module.css";
import { useHistogram } from "./useHistogram";

const WIDTH = 256;
const HEIGHT = 72;
const CHANNELS: readonly HistogramChannel[] = ["luma", "r", "g", "b"];

/**
 * The advanced panel's histogram: red, green, blue and luminance of the edited picture, with a
 * marker in each top corner that lights up while the shadows (left) or highlights (right) clip.
 */
export function HistogramPanel() {
  const { t } = useTranslation();
  const histogram = useHistogram(useSectionOpen());
  const drawn = useMemo(() => {
    if (!histogram) return null;
    const scale = sharedScale(histogram, CHANNELS);
    const paths = CHANNELS.map(channel => ({ channel, d: histogramPath(histogram[channel], WIDTH, HEIGHT, scale) }));
    return { paths, clipping: clippingOf(histogram) };
  }, [histogram]);
  const clipped = [
    drawn?.clipping.shadows ? t("editor.histogram.shadowsClipped") : null,
    drawn?.clipping.highlights ? t("editor.histogram.highlightsClipped") : null,
  ].filter(Boolean);
  return (
    <div className={classes.root}>
      <svg
        className={classes.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={[t("editor.histogram.label"), ...clipped].join(". ")}
      >
        {drawn?.paths.map(({ channel, d }) => (
          <path key={channel} d={d} className={classes[channel]} />
        ))}
        <polygon points="0,0 12,0 0,12" className={classes.clip} data-on={drawn?.clipping.shadows || undefined} />
        <polygon
          points={`${WIDTH},0 ${WIDTH - 12},0 ${WIDTH},12`}
          className={classes.clip}
          data-on={drawn?.clipping.highlights || undefined}
        />
      </svg>
      {clipped.length > 0 && (
        <Text size="xs" c="dimmed" className={classes.note} aria-hidden>
          {clipped.join(" · ")}
        </Text>
      )}
    </div>
  );
}
