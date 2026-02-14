import { Alert, Button, Center, Loader, Text } from "@mantine/core";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";

type VideoPlayerProps = {
  url: string;
  posterUrl?: string;
  height: string;
  controls: boolean;
  playing: boolean;
  onEnded?: () => void;
};

/**
 * Native HTML5 video player with loading, error, and retry states.
 * Uses the browser's built-in streaming support so transcoded video
 * from the backend (StreamingHttpResponse) plays without buffering
 * the entire file first.
 */
export const VideoPlayer = memo(function VideoPlayer({
  url,
  posterUrl,
  height,
  controls,
  playing,
  onEnded,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const readyFiredRef = useRef(false);

  // Reset state when url changes
  useEffect(() => {
    setLoading(true);
    setError(false);
    setRetryCount(0);
    readyFiredRef.current = false;
  }, [url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || loading || error) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing, loading, error]);

  const handleCanPlay = useCallback(() => {
    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      setLoading(false);
    }
  }, []);

  const handleError = useCallback(() => {
    setError(true);
    setLoading(false);
  }, []);

  const handleRetry = useCallback(() => {
    setError(false);
    setLoading(true);
    readyFiredRef.current = false;
    setRetryCount(prev => prev + 1);
  }, []);

  if (error) {
    return (
      <div
        style={{
          width: "100%",
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundImage: posterUrl ? `url(${posterUrl})` : undefined,
          backgroundSize: "contain",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          borderRadius: "8px",
        }}
      >
        <Alert
          color="red"
          title="Video Unavailable"
          style={{ maxWidth: 400, backdropFilter: "blur(8px)", background: "rgba(0,0,0,0.75)" }}
        >
          <Text size="sm">The video file could not be loaded. It may be missing, unsupported, or unavailable.</Text>
          <Button variant="light" color="red" size="xs" mt="sm" onClick={handleRetry}>
            Retry
          </Button>
        </Alert>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      {loading && (
        <Center
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1,
            backgroundImage: posterUrl ? `url(${posterUrl})` : undefined,
            backgroundSize: "contain",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            borderRadius: "8px",
          }}
        >
          <Loader color="white" size="lg" />
        </Center>
      )}
      <video
        ref={videoRef}
        key={`${url}-${retryCount}`}
        src={url}
        poster={posterUrl}
        controls={controls}
        autoPlay={playing}
        onCanPlay={handleCanPlay}
        onError={handleError}
        onEnded={onEnded}
        crossOrigin="use-credentials"
        controlsList="nodownload"
        playsInline
        style={{
          width: "100%",
          height,
          objectFit: "contain",
          borderRadius: "8px",
        }}
      />
    </div>
  );
});
