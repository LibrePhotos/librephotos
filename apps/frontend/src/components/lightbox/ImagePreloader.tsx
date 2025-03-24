import { useEffect } from "react";

import { serverAddress } from "../../api_client/apiClient";

type ImagePreloaderProps = {
  prevSrc: string | null;
  mainSrc: string;
  nextSrc: string | null;
};

export function ImagePreloader({ prevSrc, mainSrc, nextSrc }: ImagePreloaderProps) {
  // Preload images to ensure smoother swiping
  useEffect(() => {
    // Preload main image thumbnails for big view and square thumbnails
    const preloadThumbnail = (id: string | null) => {
      if (!id) return;

      // Preload big thumbnail for lightbox
      const bigImg = new Image();
      bigImg.src = `${serverAddress}/media/thumbnails_big/${id}`;

      // Preload square thumbnail for preview
      const squareImg = new Image();
      squareImg.src = `${serverAddress}/media/square_thumbnails/${id}`;
    };

    // Preload previous, main, and next thumbnails
    preloadThumbnail(prevSrc);
    preloadThumbnail(mainSrc);
    preloadThumbnail(nextSrc);
  }, [prevSrc, mainSrc, nextSrc]);

  return null;
}