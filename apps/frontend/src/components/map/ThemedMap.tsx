import { Box, Skeleton } from "@mantine/core";
import React, { useState } from "react";
import type { MapProps, MapRef } from "react-map-gl/maplibre";
import MapGL from "react-map-gl/maplibre";
import { FeatureBoundary } from "../common/FeatureBoundary";
import classes from "./ThemedMap.module.css";

type Props = Readonly<
  Omit<MapProps, "style" | "children"> & {
    /** The map's height; it fills its parent's width. */
    h: number | string;
    children?: React.ReactNode;
    ref?: React.Ref<MapRef>;
  }
>;

/**
 * Every map in the app: MapLibre in a frame that darkens it in dark mode (ThemedMap.module.css),
 * a skeleton until its style has loaded, and a boundary that keeps a WebGL failure inside the
 * frame. Layers painted on it take their colours from useMapLayerColors.
 */
export function ThemedMap({ h, children, ref, onLoad, onError, ...mapProps }: Props) {
  const [loaded, setLoaded] = useState(false);

  const handleLoad: MapProps["onLoad"] = event => {
    setLoaded(true);
    onLoad?.(event);
  };
  // A style that never loads would leave the skeleton up for good; react-map-gl logs an error
  // nobody handles, so this keeps doing that.
  const handleError: MapProps["onError"] = event => {
    setLoaded(true);
    if (onError) onError(event);
    else console.error(event.error);
  };

  return (
    <Box h={h} className={classes.frame} aria-busy={!loaded}>
      <FeatureBoundary name="map">
        {!loaded && <Skeleton className={classes.skeleton} radius={0} />}
        <MapGL {...mapProps} ref={ref} onLoad={handleLoad} onError={handleError}>
          {children}
        </MapGL>
      </FeatureBoundary>
    </Box>
  );
}
