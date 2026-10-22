import type { PigPhoto } from "@librephotos/api-client";
import React, { useState } from "react";
import { Lightbox } from "../lightbox/Lightbox";

type Props = Readonly<{
  photos: PigPhoto[];
  /** The photo it opens at. */
  startId: string;
  onClose: () => void;
}>;

/** The lightbox over the photos of a spot on the Places map (#343), stepping through all of them. */
export function SpotLightbox({ photos, startId, onClose }: Props) {
  // The lightbox snaps back to `selectedImage`: keep it on the photo shown.
  const [shownId, setShownId] = useState(startId);
  return (
    <Lightbox
      idx2hash={photos}
      isPublic={false}
      selectedImage={shownId}
      onImageChange={setShownId}
      onCloseRequest={onClose}
      onChangedIndex={() => {}}
    />
  );
}
