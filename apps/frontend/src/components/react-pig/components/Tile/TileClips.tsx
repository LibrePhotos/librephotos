import React, { useState } from "react";
import styles from "./styles.module.css";
import { useReleaseOnDetach } from "./useReleaseOnDetach";

type ClipProps = Readonly<{
  src: string;
  /** The clip could not be loaded. */
  onFailed: () => void;
}>;

/**
 * A video tile without a poster (scanned before #2026, until the poster job has run): the clip
 * itself is the grid square, mounted for every tile on screen with only its metadata preloaded,
 * and played while the pointer is on it.
 */
export function GridClip({ src, onFailed }: ClipProps) {
  const ref = useReleaseOnDetach();
  const [canPlay, setCanPlay] = useState(false);
  return (
    <video
      ref={ref}
      className={`${styles.pigImg} ${styles.pigThumbnail}${canPlay ? ` ${styles.pigThumbnailLoaded}` : ""}`}
      src={src}
      preload="metadata"
      onCanPlay={() => setCanPlay(true)}
      onMouseOver={event => void event.currentTarget.play()}
      onMouseOut={event => event.currentTarget.pause()}
      onError={onFailed}
      muted
      loop
      playsInline
    />
  );
}

/**
 * The clip over a poster while the tile is previewed (#2026): mounted only then, it starts by
 * itself and fades in once it can play, so the poster under it shows until then. Unmounting it
 * releases the player.
 */
export function PreviewClip({ src, onFailed }: ClipProps) {
  const ref = useReleaseOnDetach();
  const [canPlay, setCanPlay] = useState(false);
  return (
    <video
      ref={ref}
      className={`${styles.pigImg} ${styles.previewClip}${canPlay ? ` ${styles.previewClipPlaying}` : ""}`}
      src={src}
      preload="auto"
      autoPlay
      onCanPlay={() => setCanPlay(true)}
      onError={onFailed}
      muted
      loop
      playsInline
    />
  );
}

/** The full size clip of an expanded video tile. */
export function ExpandedClip({ src, onFailed }: ClipProps) {
  const ref = useReleaseOnDetach();
  return (
    <video
      ref={ref}
      className={styles.pigImg}
      src={src}
      preload="metadata"
      onMouseOver={event => void event.currentTarget.play()}
      onMouseOut={event => event.currentTarget.pause()}
      onError={onFailed}
      muted
      loop
      playsInline
    />
  );
}
