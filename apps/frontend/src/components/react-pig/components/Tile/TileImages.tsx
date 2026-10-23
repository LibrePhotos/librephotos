import React, { useState } from "react";
import styles from "./styles.module.css";

type Props = Readonly<{
  /** The address of the picture at a height; a poster tile asks for its video's still. */
  urlFor: (size: number) => string;
  useLqip: boolean;
  /** Off while scrolling fast: only the placeholder loads. */
  showFull: boolean;
  /** The height the grid shows the picture at. */
  gridHeight: number;
  thumbnailSize: number;
  width: number;
  height: number;
  /** The expanded tile's picture, when the tile is expanded and shows one. */
  expandedSrc: string | null;
}>;

/**
 * A tile's pictures: the blurred placeholder (LQIP), the grid image once scrolling slows down (the
 * placeholder unblurs when it has loaded), and the full size image of an expanded tile. Every image
 * is decorative; the tile's button is named.
 */
export function TileImages({
  urlFor,
  useLqip,
  showFull,
  gridHeight,
  thumbnailSize,
  width,
  height,
  expandedSrc,
}: Props) {
  const [isFullSizeLoaded, setFullSizeLoaded] = useState(false);
  return (
    <>
      {useLqip && (
        <img
          className={`${styles.pigImg} ${styles.pigThumbnail}${isFullSizeLoaded ? ` ${styles.pigThumbnailLoaded}` : ""}`}
          src={urlFor(thumbnailSize)}
          loading="lazy"
          width={width}
          height={height}
          alt=""
        />
      )}

      {showFull && (
        <img
          className={`${styles.pigImg} ${styles.pigFull}${isFullSizeLoaded ? ` ${styles.pigFullLoaded}` : ""}`}
          src={urlFor(gridHeight)}
          alt=""
          onLoad={() => setFullSizeLoaded(true)}
        />
      )}

      {expandedSrc !== null && <img className={styles.pigImg} src={expandedSrc} alt="" />}
    </>
  );
}
