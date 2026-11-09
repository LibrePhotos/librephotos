import React, { useLayoutEffect, useRef, useState } from "react";
import { hasLoaded, rememberLoaded } from "../../utils/loadedImages";
import styles from "./styles.module.css";

type Props = Readonly<{
  /** The address of the picture at a height; a poster tile asks for its video's still. */
  urlFor: (size: number) => string;
  /** The blurred placeholder (a decoded ThumbHash), shown until the image has loaded; none without one. */
  placeholderSrc: string | null;
  /** Off while scrolling fast: only the placeholder shows, unless the picture loaded before. */
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
 *
 * A picture this page has shown before (the tile scrolled out of the grid and back, or the grid was
 * laid out again) shows at once, even while scrolling fast: no placeholder, no fade.
 */
export function TileImages({ placeholderSrc, urlFor, showFull, gridHeight, width, height, expandedSrc }: Props) {
  const src = urlFor(gridHeight);
  const [loadedSrc, setLoadedSrc] = useState(() => (hasLoaded(src) ? src : null));
  // Seen at mount: shown as it is, without fading in over its placeholder.
  const [shownAtOnce] = useState(() => hasLoaded(src));
  const isLoaded = loadedSrc === src;
  const image = useRef<HTMLImageElement>(null);

  // A picture the browser already holds (its cache) can be complete before React sees a load
  // event: take it before the first paint, so the placeholder never flashes up over it.
  useLayoutEffect(() => {
    const current = image.current;
    if (!isLoaded && current?.complete && current.naturalWidth > 0) {
      rememberLoaded(src);
      setLoadedSrc(src);
    }
  }, [isLoaded, src]);

  const onLoad = () => {
    rememberLoaded(src);
    setLoadedSrc(src);
  };

  return (
    <>
      {placeholderSrc !== null && !shownAtOnce && (
        <img className={styles.pigImg} src={placeholderSrc} width={width} height={height} alt="" />
      )}

      {(showFull || hasLoaded(src)) && (
        <img
          ref={image}
          className={[
            styles.pigImg,
            styles.pigFull,
            isLoaded ? styles.pigFullLoaded : "",
            shownAtOnce ? styles.pigFullAtOnce : "",
          ]
            .filter(Boolean)
            .join(" ")}
          src={src}
          width={width}
          height={height}
          alt=""
          onLoad={onLoad}
        />
      )}

      {expandedSrc !== null && <img className={styles.pigImg} src={expandedSrc} alt="" />}
    </>
  );
}
