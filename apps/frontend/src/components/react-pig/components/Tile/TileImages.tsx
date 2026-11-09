import React, { useState } from "react";
import styles from "./styles.module.css";

type Props = Readonly<{
  /** The address of the picture at a height; a poster tile asks for its video's still. */
  urlFor: (size: number) => string;
  /** The blurred placeholder (a decoded ThumbHash), shown until the image has loaded; none without one. */
  placeholderSrc: string | null;
  /** Off while scrolling fast: only the placeholder shows. */
  showFull: boolean;
  /** The height the grid shows the picture at. */
  gridHeight: number;
  width: number;
  height: number;
  /** The expanded tile's picture, when the tile is expanded and shows one. */
  expandedSrc: string | null;
}>;

/**
 * A tile's pictures: the blurred placeholder decoded from the photo's ThumbHash (no request of its
 * own), the grid image once scrolling slows down (it fades in over the placeholder), and the full
 * size image of an expanded tile. Every image is decorative; the tile's button is named.
 */
export function TileImages({ placeholderSrc, urlFor, showFull, gridHeight, width, height, expandedSrc }: Props) {
  const [isFullSizeLoaded, setFullSizeLoaded] = useState(false);
  return (
    <>
      {placeholderSrc !== null && (
        <img className={styles.pigImg} src={placeholderSrc} width={width} height={height} alt="" />
      )}

      {showFull && (
        <img
          className={`${styles.pigImg} ${styles.pigFull}${isFullSizeLoaded ? ` ${styles.pigFullLoaded}` : ""}`}
          src={urlFor(gridHeight)}
          width={width}
          height={height}
          alt=""
          onLoad={() => setFullSizeLoaded(true)}
        />
      )}

      {expandedSrc !== null && <img className={styles.pigImg} src={expandedSrc} alt="" />}
    </>
  );
}
