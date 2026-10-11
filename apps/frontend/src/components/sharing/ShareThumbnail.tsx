import { Image } from "@mantine/core";
import React, { useState } from "react";
import { serverAddress } from "../../api_client/apiClient";

type Props = Readonly<{
  imageHash: string;
  size: number;
  /** "square_thumbnails_small" for a list row, "square_thumbnails" for a cover. */
  kind?: "square_thumbnails" | "square_thumbnails_small";
  className?: string;
  radius?: number | string;
}>;

/** The cover radius shared with the album covers (Mantine's md, 8px). */
const COVER_RADIUS = "var(--mantine-radius-md)";

/**
 * The thumbnail of a photo share link. The share list does not say whether the
 * photo is a video, and a video's thumbnail is a short clip that an <img>
 * shows as a broken image: fall back to a <video> showing its first frame.
 */
export function ShareThumbnail({
  imageHash,
  size,
  kind = "square_thumbnails_small",
  className,
  radius = kind === "square_thumbnails" ? COVER_RADIUS : 4,
}: Props) {
  const [isVideo, setIsVideo] = useState(false);
  const src = `${serverAddress}/media/${kind}/${imageHash}`;

  if (isVideo) {
    return (
      <video
        // "#t=0.001" makes Safari paint the first frame (see Tile.tsx).
        src={`${src}#t=0.001`}
        width={size}
        height={size}
        className={className}
        style={{ objectFit: "cover", borderRadius: radius, display: "block", flexShrink: 0 }}
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  return (
    <Image
      src={src}
      w={size}
      h={size}
      className={className}
      style={{ borderRadius: radius, flexShrink: 0 }}
      alt=""
      onError={() => setIsVideo(true)}
    />
  );
}
