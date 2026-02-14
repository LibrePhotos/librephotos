import { Image } from "@mantine/core";
import type { CSSProperties, MouseEventHandler } from "react";
import React, { useState } from "react";
import { serverAddress } from "../api_client/apiClient";

type DefaultProps = {
  style: CSSProperties;
  video: boolean;
  onClick: (e: MouseEventHandler<HTMLElement>) => void;
  className: string;
};

type Props = {
  width: number;
  height: number;
  image_hash: string;
} & Partial<DefaultProps>;

export function Tile({ video, width, height, style, image_hash, className }: Props) {
  const [videoFailed, setVideoFailed] = useState(false);
  const src = `${serverAddress}/media/square_thumbnails/${image_hash}`;

  if (video && !videoFailed) {
    return (
      <video
        width={width}
        height={height}
        style={style}
        className={className}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        onError={() => setVideoFailed(true)}
      />
    );
  }
  return <Image className={className} style={style} width={width} height={height} src={src} />;
}
