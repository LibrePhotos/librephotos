import { Box, Image, type MantineRadius } from "@mantine/core";
import clsx from "clsx";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { mediaUrl } from "../../api_client/media/mediaUrl";
import classes from "./MediaThumbnail.module.css";

type Props = Readonly<{
  imageHash: string;
  size: number;
  /** "square_thumbnails_small" for a list row, "square_thumbnails" for a cover. */
  kind?: "square_thumbnails" | "square_thumbnails_small";
  /** Whether it is a video, when the caller knows. Left out, an image that fails to load is shown as a video. */
  video?: boolean;
  className?: string;
  radius?: MantineRadius;
  /** The text alternative. Empty (decorative) by default. */
  alt?: string;
}>;

/**
 * A photo's or video's square thumbnail, still. A video's square thumbnail is a short mp4 clip (with
 * video previews on, the default), which an <img> shows as a broken image, so a video gets a <video>
 * showing its first frame. A caller that does not know the type (a list of hashes, a share) gets the
 * <img> first and the <video> when the image fails to load.
 *
 * Every square thumbnail outside the photo grid and the cover tiles (components/Tile.tsx) goes through
 * here (`ban/square-thumbnail-url`), so a video shows in every dialog and list (#2707).
 */
export function MediaThumbnail({
  imageHash,
  size,
  kind = "square_thumbnails_small",
  video = false,
  className,
  // A cover shares the album covers' radius (Mantine's md, 8px).
  radius = kind === "square_thumbnails" ? "md" : 4,
  alt = "",
}: Props) {
  const [failedAsImage, setFailedAsImage] = useState(false);
  const videoNode = useRef<HTMLVideoElement | null>(null);
  const src =
    kind === "square_thumbnails" ? mediaUrl.squareThumbnail(imageHash) : mediaUrl.squareThumbnailSmall(imageHash);

  // Never cleared, see Tile.tsx: React detaches refs before the cleanup below runs.
  const holdVideoNode = useCallback((node: HTMLVideoElement | null) => {
    if (node) videoNode.current = node;
  }, []);

  // Unmounting a <video> does not free its media player or cancel its fetch (see Tile.tsx); a
  // selection preview can hold a hundred of them.
  useEffect(
    () => () => {
      const element = videoNode.current;
      if (!element) return;
      element.removeAttribute("src");
      element.load();
    },
    []
  );

  if (video || failedAsImage) {
    return (
      <Box
        component="video"
        ref={holdVideoNode}
        // "#t=0.001" makes Safari paint the first frame (see Tile.tsx).
        src={`${src}#t=0.001`}
        width={size}
        height={size}
        className={clsx(classes.thumbnail, classes.video, className)}
        bdrs={radius}
        muted
        playsInline
        preload="metadata"
        // A <video> has no alt: the name comes from aria-label, and a decorative one is hidden.
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
      />
    );
  }
  return (
    <Image
      src={src}
      w={size}
      h={size}
      className={clsx(classes.thumbnail, className)}
      radius={radius}
      alt={alt}
      onError={() => setFailedAsImage(true)}
    />
  );
}
