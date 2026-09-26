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

function startPreview(element: HTMLVideoElement) {
  void element.play().catch(() => {
    /* a play() the browser refuses is not a failed video */
  });
}

function stopPreview(element: HTMLVideoElement) {
  element.pause();
  element.currentTime = 0;
}

export function Tile({ video, width, height, style, image_hash, className }: Props) {
  const [videoFailed, setVideoFailed] = useState(false);
  const src = `${serverAddress}/media/square_thumbnails/${image_hash}`;
  const videoNode = useRef<HTMLVideoElement | null>(null);

  // Deliberately never cleared: React detaches refs before it runs effect
  // cleanups, so a plain ref would already be null by the time the cleanup
  // below needs the element. Same pattern as the photo grid tile
  // (react-pig/components/Tile/Tile.jsx, #2018).
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

  // Covers usually sit inside a link (album, person, thing and place grids).
  // The <video> itself is not focusable, so start the preview when that
  // surrounding link or button (e.g. the cover picker) receives keyboard
  // focus, like hover does. Not generic [tabindex]: modal containers carry
  // tabindex="-1" and would start every cover in the dialog at once.
  const isVideoShown = video && !videoFailed;
  useEffect(() => {
    const element = videoNode.current;
    const focusTarget = isVideoShown ? element?.closest<HTMLElement>("a[href], button") : null;
    if (!element || !focusTarget) return undefined;
    const start = () => startPreview(element);
    const stop = () => stopPreview(element);
    focusTarget.addEventListener("focusin", start);
    focusTarget.addEventListener("focusout", stop);
    return () => {
      focusTarget.removeEventListener("focusin", start);
      focusTarget.removeEventListener("focusout", stop);
    };
  }, [isVideoShown]);

  if (isVideoShown) {
    return (
      <video
        ref={holdVideoNode}
        width={width}
        height={height}
        style={style}
        className={className}
        // "#t=0.001" makes iOS Safari paint the first frame; with
        // preload="metadata" and no poster it otherwise shows nothing.
        src={`${src}#t=0.001`}
        muted
        loop
        playsInline
        // No autoPlay: a cover is a cover. Every album, person, thing and
        // place page renders one of these per tile, and letting them all run
        // keeps that many decoders busy for as long as the page is open
        // (#2027). preload="metadata" fetches the first frame to show rather
        // than the whole 5 second clip.
        preload="metadata"
        onMouseEnter={event => startPreview(event.currentTarget)}
        onMouseLeave={event => stopPreview(event.currentTarget)}
        onError={() => setVideoFailed(true)}
      />
    );
  }
  return <Image className={className} style={style} width={width} height={height} src={src} />;
}
