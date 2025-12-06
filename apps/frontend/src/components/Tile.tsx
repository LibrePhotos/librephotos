import { Image } from "@mantine/core";
import type { CSSProperties, MouseEventHandler } from "react";
import React from "react";

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
  if (video) {
    return (
      <video
        width={width}
        height={height}
        style={style}
        className={className}
        src={`${serverAddress}/media/square_thumbnails/${image_hash}`}
        autoPlay
        muted
        loop
        playsInline
      />
    );
  }
  return (
    <Image className={className} style={style} width={width} height={height} src={`${serverAddress}/media/square_thumbnails/${image_hash}`} />
  );
}
