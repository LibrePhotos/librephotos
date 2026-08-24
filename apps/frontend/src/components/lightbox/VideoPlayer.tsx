import { Alert, Button, Center, Code, Group, Loader, Stack, Text } from "@mantine/core";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useMediaDiagnosticsQuery } from "../../api_client/media";

type VideoPlayerProps = {
  url: string;
  posterUrl?: string;
  height: string;
  controls: boolean;
  playing: boolean;
  mediaHash?: string;
  onEnded?: () => void;
};

/**
 * What actually went wrong. A `<video>` element only ever reports *that* it
 * failed -- `error.code` distinguishes a network problem from an undecodable
 * stream and nothing more -- so these are recovered by re-requesting the same
 * URL and reading the HTTP status, which is the only place the difference lives.
 */
export type VideoErrorKind = "permission" | "missing" | "format" | "server" | "session" | "unknown";

/**
 * Turn the probe's HTTP response into a cause.
 *
 * A 200 here is the interesting one: the file was delivered whole and the
 * browser still refused it, which is the *only* circumstance in which blaming
 * the format is honest. The player used to say that about every failure.
 *
 * 403 is ambiguous by nature -- an expired session and a file the web server
 * cannot open both produce one -- so the backend marks its own refusals with
 * `X-Media-Error`. Without the header the far likelier cause is the file, and
 * that is what an unmarked 403 is read as.
 */
export function classifyVideoFailure(status: number, mediaError: string | null): VideoErrorKind {
  if (status >= 200 && status < 300) return "format";
  if (status === 401) return "session";
  if (status === 403) return mediaError === "authentication" ? "session" : "permission";
  if (status === 404) return "missing";
  return "server";
}

const REMEDY_KEYS: Record<string, string> = {
  chmod: "remedychmod",
  mount_options: "remedymountoptions",
  mount_deeper: "remedymountdeeper",
  read_only: "remedyreadonly",
  network_fs: "remedynetworkfs",
  labels: "remedylabels",
};

/**
 * Native HTML5 video player with loading, error, and retry states.
 * Uses the browser's built-in streaming support so transcoded video
 * from the backend (StreamingHttpResponse) plays without buffering
 * the entire file first.
 *
 * On failure it works out *why* before saying anything. Originals are served by
 * the web server straight from the library, and that process runs as a far less
 * privileged user than the scanner, so the single most common reason a video
 * will not play is that the file cannot be read at all -- nothing to do with
 * the video. Reporting every failure as "unsupported or unavailable" is what
 * made issue #714 unsolvable from a bug report for years.
 */
export const VideoPlayer = memo(function VideoPlayer({
  url,
  posterUrl,
  height,
  controls,
  playing,
  mediaHash,
  onEnded,
}: VideoPlayerProps) {
  const { t } = useTranslation();
  const { data: auth } = useAccessToken();
  const isAdmin = !!auth?.access?.is_admin;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<VideoErrorKind | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [probing, setProbing] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const readyFiredRef = useRef(false);
  // Bumped on every probe so a stale answer cannot overwrite a newer one after
  // the user has already navigated to a different video.
  const probeRef = useRef(0);

  const hasError = errorKind !== null;
  // Only the permission case has anything to diagnose, and only an administrator
  // may see it: the answer is made of absolute paths, ownership and mode bits,
  // which are no use to someone who cannot act on them.
  const { data: diagnostics } = useMediaDiagnosticsQuery(mediaHash, errorKind === "permission" && isAdmin);

  // Reset state when url changes
  useEffect(() => {
    setLoading(true);
    setErrorKind(null);
    setErrorStatus(null);
    setProbing(false);
    setRetryCount(0);
    readyFiredRef.current = false;
    probeRef.current += 1;
  }, [url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || loading || hasError) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [playing, loading, hasError]);

  const handleCanPlay = useCallback(() => {
    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      setLoading(false);
    }
  }, []);

  const handleError = useCallback(() => {
    setLoading(false);
    setErrorKind("unknown");
    setProbing(true);

    probeRef.current += 1;
    const probeId = probeRef.current;

    const probe = async () => {
      let kind: VideoErrorKind = "unknown";
      let status: number | null = null;
      try {
        // HEAD, not GET: the status is all we need, and a GET would re-download
        // the whole file in the one case where it did arrive intact.
        const response = await fetch(url, { method: "HEAD", credentials: "include" });
        status = response.status;
        kind = classifyVideoFailure(response.status, response.headers.get("X-Media-Error"));
      } catch {
        // The probe itself could not complete; fall back to the old wording
        // rather than inventing a cause.
        kind = "unknown";
      }
      if (probeRef.current !== probeId) return;
      setErrorKind(kind);
      setErrorStatus(status);
      setProbing(false);
    };

    void probe();
  }, [url]);

  const handleRetry = useCallback(() => {
    setErrorKind(null);
    setErrorStatus(null);
    setProbing(false);
    setLoading(true);
    readyFiredRef.current = false;
    probeRef.current += 1;
    setRetryCount(prev => prev + 1);
  }, []);

  const errorTitle = () => {
    switch (errorKind) {
      case "permission":
        return t("lightbox.videoerror.permissiontitle");
      case "missing":
        return t("lightbox.videoerror.missingtitle");
      case "format":
        return t("lightbox.videoerror.formattitle");
      case "server":
        return t("lightbox.videoerror.servertitle");
      case "session":
        return t("lightbox.videoerror.sessiontitle");
      default:
        return t("lightbox.videoerror.unknowntitle");
    }
  };

  const errorBody = () => {
    switch (errorKind) {
      case "permission":
        return isAdmin ? t("lightbox.videoerror.permissionadmin") : t("lightbox.videoerror.permissionuser");
      case "missing":
        return t("lightbox.videoerror.missing");
      case "format":
        return t("lightbox.videoerror.format");
      case "server":
        return t("lightbox.videoerror.server", { status: errorStatus ?? "" });
      case "session":
        return t("lightbox.videoerror.session");
      default:
        return t("lightbox.videoerror.unknown");
    }
  };

  const renderDiagnostics = () => {
    if (!diagnostics) return null;
    const { blocking, webserver, mount, remedies } = diagnostics;
    const remedyKeys = remedies.map(remedy => REMEDY_KEYS[remedy]).filter(Boolean);

    return (
      <Stack gap={4} mt="sm">
        <Text size="xs" fw={600}>
          {t("lightbox.videoerror.diagnosticstitle")}
        </Text>
        {blocking && (
          <Text size="xs">
            {blocking.kind === "directory"
              ? t("lightbox.videoerror.blockeddirectory")
              : t("lightbox.videoerror.blockedfile")}{" "}
            <Code>{blocking.path}</Code>
            {blocking.mode &&
              ` — ${t("lightbox.videoerror.modeandowner", {
                mode: blocking.mode,
                uid: blocking.uid,
                gid: blocking.gid,
              })}`}
          </Text>
        )}
        {webserver && (
          <Text size="xs">{t("lightbox.videoerror.webserverids", { uid: webserver.uid, gid: webserver.gid })}</Text>
        )}
        {mount && (
          <Text size="xs">{t("lightbox.videoerror.filesystem", { type: mount.type, point: mount.point })}</Text>
        )}
        {remedyKeys.map(key => (
          <Text key={key} size="xs">
            {t(`lightbox.videoerror.${key}`)}
          </Text>
        ))}
      </Stack>
    );
  };

  if (hasError) {
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
          title={errorTitle()}
          style={{ maxWidth: 560, backdropFilter: "blur(8px)", background: "rgba(0,0,0,0.75)" }}
        >
          {probing ? (
            <Group gap="xs">
              <Loader size="xs" color="red" />
              <Text size="sm">{t("lightbox.videoerror.checking")}</Text>
            </Group>
          ) : (
            <>
              <Text size="sm">{errorBody()}</Text>
              {renderDiagnostics()}
            </>
          )}
          <Button variant="light" color="red" size="xs" mt="sm" onClick={handleRetry}>
            {t("lightbox.videoerror.retry")}
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
