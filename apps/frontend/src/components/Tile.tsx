import type { CSSProperties, MouseEventHandler } from "react";
import React from "react";

import { Image } from "@mantine/core";

import { serverAddress } from "../api_client/apiClient";

type DefaultProps = {
  style: CSSProperties;
  video: boolean;
  onClick: (e: MouseEventHandler<HTMLElement>) => void;
};

type Props = {
  width: number;
  height: number;
  image_hash: string;
} & Partial<DefaultProps>;

export function Tile({ video, width, height, style, image_hash }: Props) {
  if (video) {
    return (
      <video
        width={width}
        height={height}
        style={style}
        src={`${serverAddress}/media/square_thumbnails/${image_hash}`}
        autoPlay
        muted
        loop
        playsInline
      />
    );
  }
  return (
    <Image style={style} width={width} height={height} src={`${serverAddress}/media/square_thumbnails/${image_hash}`} />
  );
}
