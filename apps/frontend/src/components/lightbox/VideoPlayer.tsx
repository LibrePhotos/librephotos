import { ActionIcon, Alert, Button, Center, Code, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { IconCopy as CopyIcon } from "@tabler/icons-react";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useMediaDiagnosticsQuery } from "../../api_client/media";
import { probeMedia } from "../../api_client/media/mediaUrl";
import { copyToClipboard } from "../../util/util";
import { useSeekShortcut } from "./useSeekShortcut";
import { useVideoStart } from "./useVideoStart";
import type { DiagnosticFact, VideoErrorKind } from "./videoFailure";
import { classifyVideoFailure, factToText, formatSeekDistance, REMEDY_KEYS } from "./videoFailure";
import classes from "./VideoPlayer.module.css";
import type { VideoStart } from "./videoStart";
import { VideoStartNote } from "./VideoStartNote";

type VideoPlayerProps = {
  url: string;
  /**
   * Where to get this video converted, for when the browser turns out not to
   * decode the original after all: a file served whole that still will not
   * play. Tried once, before any error is shown.
   */
  fallbackUrl?: string;
  posterUrl?: string;
  height: string;
  /**
   * With `height` "auto": the video keeps its own shape, as large as the
   * width and this height allow, instead of filling a fixed box.
   */
  maxHeight?: string;
  controls: boolean;
  playing: boolean;
  mediaHash?: string;
  onEnded?: () => void;
  /**
   * Whether the server can convert this clip at all. A motion photo's clip is
   * always served as it is, so advising a conversion setting would not help.
   */
  convertible?: boolean;
  /** Start at a face's moment instead of 0:00 (#2762); a note says so. */
  start?: VideoStart;
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
  fallbackUrl,
  posterUrl,
  height,
  maxHeight,
  controls,
  playing,
  mediaHash,
  onEnded,
  convertible = true,
  start,
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
  const [copied, setCopied] = useState(false);
  const readyFiredRef = useRef(false);
  // Whether the original was refused and the converted copy is playing instead.
  // Mirrored in a ref for the probe, which outlives the render it started in.
  const [usingFallback, setUsingFallback] = useState(false);
  const usingFallbackRef = useRef(false);
  const src = usingFallback && fallbackUrl ? fallbackUrl : url;
  const videoStart = useVideoStart(videoRef, start, src);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every probe so a stale answer cannot overwrite a newer one after
  // the user has already navigated to a different video.
  const probeRef = useRef(0);
  const seekHint = useSeekShortcut(videoRef, url);

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
    setUsingFallback(false);
    usingFallbackRef.current = false;
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

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    []
  );

  const handleCanPlay = useCallback(() => {
    if (!readyFiredRef.current) {
      readyFiredRef.current = true;
      setLoading(false);
    }
  }, []);

  const handleError = useCallback(() => {
    // With a conversion still in reserve the probe most likely ends in a retry,
    // so keep the spinner up instead of flashing an error panel for a moment.
    const mayFallBack = !!fallbackUrl && !usingFallbackRef.current;
    if (mayFallBack) {
      setLoading(true);
    } else {
      setLoading(false);
      setErrorKind("unknown");
    }
    setProbing(true);

    probeRef.current += 1;
    const probeId = probeRef.current;

    const probe = async () => {
      let kind: VideoErrorKind;
      let status: number | null = null;
      try {
        // HEAD, not GET: the status is all we need, and a GET would re-download
        // the whole file in the one case where it did arrive intact.
        const answer = await probeMedia(src);
        status = answer.status;
        kind = classifyVideoFailure(answer.status, answer.mediaError);
      } catch {
        // The probe itself could not complete; fall back to the old wording
        // rather than inventing a cause.
        kind = "unknown";
      }
      if (probeRef.current !== probeId) return;
      // The file arrived whole and the browser still refused it, which is the
      // one failure a conversion fixes -- so convert before saying anything.
      if (kind === "format" && fallbackUrl && !usingFallbackRef.current) {
        usingFallbackRef.current = true;
        readyFiredRef.current = false;
        setUsingFallback(true);
        setErrorKind(null);
        setProbing(false);
        setLoading(true);
        return;
      }
      setLoading(false);
      setErrorKind(kind);
      setErrorStatus(status);
      setProbing(false);
    };

    void probe();
  }, [src, fallbackUrl]);

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
      case "unknown":
      case null:
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
        // Nothing converts this clip for this viewer: a motion photo's clip is
        // served as it is, and a visitor without an account always gets the
        // original (any ?transcode=1 is ignored), so neither the setting nor
        // "the conversion failed" applies.
        if (!convertible || !auth?.access) return t("lightbox.videoerror.formatnoconversion");
        // Already converted and still refused: advising a conversion would
        // send the user to a switch that cannot help.
        return src.includes("transcode=1") ? t("lightbox.videoerror.formatconverted") : t("lightbox.videoerror.format");
      case "server":
        return t("lightbox.videoerror.server", { status: errorStatus ?? "" });
      case "session":
        return t("lightbox.videoerror.session");
      case "unknown":
      case null:
        return t("lightbox.videoerror.unknown");
    }
  };

  const diagnosticFacts = (): DiagnosticFact[] => {
    if (!diagnostics) return [];
    const { blocking, webserver, mount, remedies } = diagnostics;
    const facts: DiagnosticFact[] = [];
    if (blocking) {
      facts.push({
        label:
          blocking.kind === "directory"
            ? t("lightbox.videoerror.blockeddirectory")
            : t("lightbox.videoerror.blockedfile"),
        code: blocking.path,
        suffix: blocking.mode
          ? t("lightbox.videoerror.modeandowner", {
              mode: blocking.mode,
              uid: blocking.uid,
              gid: blocking.gid,
            })
          : undefined,
      });
    }
    if (webserver) {
      facts.push({ label: t("lightbox.videoerror.webserverids", { uid: webserver.uid, gid: webserver.gid }) });
    }
    if (mount) {
      facts.push({ label: t("lightbox.videoerror.filesystem", { type: mount.type, point: mount.point }) });
    }
    remedies
      .map(remedy => REMEDY_KEYS[remedy])
      .filter(key => key !== undefined)
      .forEach(key => facts.push({ label: t(key) }));
    return facts;
  };

  /** The whole diagnosis as plain text, ready to paste into a terminal or an
   * issue. Everything here is meant to leave the browser -- a path to chmod, a
   * mount to re-mount, a report to hand to whoever administers the server -- so
   * re-typing it off the screen would defeat the point of collecting it. */
  const buildReport = () => {
    const facts = diagnosticFacts();
    return [
      t("lightbox.videoerror.copyheading"),
      "",
      errorTitle(),
      errorBody(),
      "",
      // The request that actually failed, which after a fallback is the conversion.
      src,
      ...(facts.length ? ["", `${t("lightbox.videoerror.diagnosticstitle")}:`, ...facts.map(factToText)] : []),
    ].join("\n");
  };

  const handleCopy = () => {
    copyToClipboard(buildReport());
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1200);
  };

  const renderDiagnostics = () => {
    const facts = diagnosticFacts();
    if (!facts.length) return null;

    return (
      <Stack gap={4} mt="sm">
        <Text size="xs" fw={600}>
          {t("lightbox.videoerror.diagnosticstitle")}
        </Text>
        {facts.map(fact => (
          <Text key={factToText(fact)} size="xs">
            {fact.label} {fact.code ? <Code>{fact.code}</Code> : null}
            {fact.suffix ? ` - ${fact.suffix}` : null}
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
          style={{ maxWidth: 560, backdropFilter: "blur(8px)", background: "var(--app-scrim-black-75)" }}
          // The box is dark in both colour schemes, but the light scheme colours
          // the message black.
          styles={{
            message: { color: "var(--mantine-color-white)" },
            title: { color: "var(--mantine-color-red-4)" },
          }}
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
          <Group gap="xs" mt="sm">
            <Button variant="light" color="red" size="xs" onClick={handleRetry}>
              {t("lightbox.videoerror.retry")}
            </Button>
            {!probing && (
              <Tooltip
                label={copied ? t("lightbox.videoerror.copied") : t("lightbox.videoerror.copy")}
                opened={copied ? true : undefined}
              >
                <ActionIcon
                  variant="light"
                  color="red"
                  size="sm"
                  aria-label={t("lightbox.videoerror.copy")}
                  onClick={handleCopy}
                >
                  <CopyIcon size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
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
          <Stack align="center" gap="sm">
            <Loader color="white" size="lg" />
            {/* A conversion can take many seconds to start; say why it waits. */}
            {src.includes("transcode=1") && (
              <Text
                size="sm"
                c="white"
                ta="center"
                style={{ background: "var(--app-scrim-black-65)", borderRadius: 8, padding: "4px 12px" }}
              >
                {t("lightbox.video.converting")}
              </Text>
            )}
          </Stack>
        </Center>
      )}
      {seekHint !== null && (
        <Center style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
          <Text
            size="xl"
            fw={600}
            c="white"
            style={{ background: "var(--app-scrim-black-65)", borderRadius: 8, padding: "8px 16px" }}
          >
            {seekHint === "unavailable" ? t("lightbox.video.seekunavailable") : formatSeekDistance(seekHint.seconds)}
          </Text>
        </Center>
      )}
      <VideoStartNote notice={videoStart.notice} onPlayFromStart={videoStart.playFromStart} />
      <video
        ref={videoRef}
        // `url` too: when it changes to the stream already playing (the details
        // arrived after the fallback picked it), the reset above clears the
        // ready flag, and only a fresh element fires canplay again.
        key={`${url}|${src}-${retryCount}`}
        src={src}
        poster={posterUrl}
        controls={controls}
        autoPlay={playing}
        onCanPlay={handleCanPlay}
        onLoadedMetadata={videoStart.onLoadedMetadata}
        onError={handleError}
        onEnded={onEnded}
        crossOrigin="use-credentials"
        controlsList="nodownload"
        playsInline
        className={classes.video}
        style={{
          // At its own shape ("auto"), the element is as wide as the picture,
          // so a portrait clip's control bar is not stretched across the page.
          width: height === "auto" ? "auto" : "100%",
          height,
          maxHeight,
        }}
      />
    </div>
  );
});
