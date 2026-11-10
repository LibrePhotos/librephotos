import { Center, Modal } from "@mantine/core";
import React, { Suspense } from "react";
import { FeatureBoundary, FeatureFallback } from "../common/FeatureBoundary";
import { lazyWithPreload } from "../common/lazyWithPreload";
import { PageLoader } from "../common/PageLoader";
import type { Lightbox } from "./Lightbox";

type LightboxProps = React.ComponentProps<typeof Lightbox>;

/**
 * The lightbox is its own chunk, so a photo grid's first load does not wait for it: a grid
 * prefetches it once the browser is idle (PhotoListView), so it opens at once when a photo is
 * clicked.
 */
export const lightbox = lazyWithPreload<LightboxProps>(async () => (await import("./Lightbox")).Lightbox);

/**
 * The lightbox from a grid. Until its chunk is in (a click before the prefetch finished), the
 * viewer's own black full-screen frame with a spinner, which Escape closes like the viewer. A chunk
 * that fails to load (offline, or a tab older than the last deploy) gets the lightbox's own error
 * dialog, whose Retry loads it again.
 */
export function LazyLightbox(props: LightboxProps) {
  const { onCloseRequest } = props;
  return (
    <FeatureBoundary
      name="lightbox"
      onReset={lightbox.retry}
      fallback={({ reset }) => (
        <Modal opened onClose={onCloseRequest} centered>
          <FeatureFallback reset={reset} />
        </Modal>
      )}
    >
      <Suspense
        fallback={
          <Modal.Root opened onClose={onCloseRequest} fullScreen>
            <Modal.Overlay color="black" backgroundOpacity={1} />
            <Modal.Content bg="transparent">
              <Center h="100vh">
                <PageLoader />
              </Center>
            </Modal.Content>
          </Modal.Root>
        }
      >
        <lightbox.Component {...props} />
      </Suspense>
    </FeatureBoundary>
  );
}
