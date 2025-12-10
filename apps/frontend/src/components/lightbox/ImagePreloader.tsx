import { useEffect, useRef } from "react";

import { serverAddress } from "../../api_client/apiClient";

type ImagePreloaderProps = {
  prevSrc: string | null;
  mainSrc: string;
  nextSrc: string | null;
};

export function ImagePreloader({ prevSrc, mainSrc, nextSrc }: ImagePreloaderProps) {
  // Keep track of created images for cleanup
  const preloadedImagesRef = useRef<HTMLImageElement[]>([]);
  
  // Preload images to ensure smoother swiping
  useEffect(() => {
    const preloadImages: HTMLImageElement[] = [];
    
    // Preload main image thumbnails for big view and square thumbnails
    const preloadThumbnail = (id: string | null) => {
      if (!id) return;

      // Preload big thumbnail for lightbox
      const bigImg = new Image();
      bigImg.src = `${serverAddress}/media/thumbnails_big/${id}`;
      preloadImages.push(bigImg);

      // Preload square thumbnail for preview
      const squareImg = new Image();
      squareImg.src = `${serverAddress}/media/square_thumbnails/${id}`;
      preloadImages.push(squareImg);
    };

    // Preload previous, main, and next thumbnails
    preloadThumbnail(prevSrc);
    preloadThumbnail(mainSrc);
    preloadThumbnail(nextSrc);
    
    // Store references for cleanup
    preloadedImagesRef.current = preloadImages;
    
    // Cleanup function: cancel loading and release references
    return () => {
      // Cancel any pending image loads and release references
      preloadedImagesRef.current.forEach(img => {
        img.src = ''; // Cancel loading
        img.onload = null; // Remove any load handlers
        img.onerror = null; // Remove any error handlers
      });
      preloadedImagesRef.current = [];
    };
  }, [prevSrc, mainSrc, nextSrc]);

  return null;
}