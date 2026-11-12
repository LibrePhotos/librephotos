import { Center, Modal } from "@mantine/core";
import React, { Suspense } from "react";
import { FeatureBoundary, FeatureFallback } from "../common/FeatureBoundary";
import { lazyWithPreload } from "../common/lazyWithPreload";
import { PageLoader } from "../common/PageLoader";
import type { PhotoEditorProps } from "./PhotoEditor";

/** The photo editor is its own chunk (the WebGL renderer and its shaders): fetched when wanted. */
export const photoEditor = lazyWithPreload<PhotoEditorProps>(async () => (await import("./PhotoEditor")).PhotoEditor);

/**
 * The photo editor from the lightbox. Until its chunk is in, a black full-screen frame with a
 * spinner; a chunk that fails to load gets an error dialog whose Retry loads it again.
 */
export function LazyPhotoEditor(props: PhotoEditorProps) {
  const { onClose } = props;
  return (
    <FeatureBoundary
      name="photoEditor"
      onReset={photoEditor.retry}
      fallback={({ reset }) => (
        <Modal opened onClose={onClose} centered>
          <FeatureFallback reset={reset} />
        </Modal>
      )}
    >
      <Suspense
        fallback={
          <Modal.Root opened onClose={onClose} fullScreen>
            <Modal.Overlay color="black" backgroundOpacity={1} />
            <Modal.Content bg="transparent">
              <Center h="100vh">
                <PageLoader />
              </Center>
            </Modal.Content>
          </Modal.Root>
        }
      >
        <photoEditor.Component {...props} />
      </Suspense>
    </FeatureBoundary>
  );
}
