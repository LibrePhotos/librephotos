import { Image } from "@mantine/core";
import type { CSSProperties, MouseEventHandler } from "react";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
  const videoNode = useRef<HTMLVideoElement | null>(null);

  // Deliberately never cleared: React detaches refs before it runs effect
  // cleanups, so a plain ref would already be null by the time the cleanup
  // below needs the element. Same reasoning as the grid tile (#970).
  const holdVideoNode = useCallback((node: HTMLVideoElement | null) => {
    if (node) videoNode.current = node;
  }, []);

  // Unmounting a <video> does not free its media player or cancel the fetch
  // still in flight; the browser holds both until the element is collected.
  useEffect(
    () => () => {
      const element = videoNode.current;
      if (!element) return;
      element.pause();
      element.removeAttribute("src");
      element.load();
    },
    []
  );

  if (video && !videoFailed) {
    return (
      <video
        ref={holdVideoNode}
        width={width}
        height={height}
        style={style}
        className={className}
        src={src}
        muted
        loop
        playsInline
        // No autoPlay: a cover is a cover. Every album, person, thing and
        // place page renders one of these per tile, and letting them all run
        // keeps that many decoders busy for as long as the page is open
        // (#2027). preload="metadata" fetches the first frame to show rather
        // than the whole 5 second clip.
        preload="metadata"
        onMouseEnter={event => {
          void event.currentTarget.play().catch(() => {
            /* a play() the browser refuses is not a failed video */
          });
        }}
        onMouseLeave={event => {
          event.currentTarget.pause();
          event.currentTarget.currentTime = 0;
        }}
        onError={() => setVideoFailed(true)}
      />
    );
  }
  return <Image className={className} style={style} width={width} height={height} src={src} />;
}
