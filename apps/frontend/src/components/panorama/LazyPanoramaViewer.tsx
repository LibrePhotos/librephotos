import React, { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { FeatureBoundary } from "../common/FeatureBoundary";
import { PageLoader } from "../common/PageLoader";
import type { PanoramaViewerProps } from "./PanoramaViewer";

// Photo Sphere Viewer and three.js are a few hundred kB: their own chunk, fetched the first time a
// sphere is opened in 360°, never by the main bundle.
const PanoramaViewer = lazy(async () => ({ default: (await import("./PanoramaViewer")).PanoramaViewer }));

/** The 360° viewer, loaded on first use; a failure to load or render it stays inside the media box. */
export function LazyPanoramaViewer(props: PanoramaViewerProps) {
  const { t } = useTranslation();
  return (
    <FeatureBoundary name="panorama" resetKeys={[props.src]}>
      <Suspense fallback={<PageLoader label={t("lightbox.panorama.loading")} />}>
        <PanoramaViewer {...props} />
      </Suspense>
    </FeatureBoundary>
  );
}
