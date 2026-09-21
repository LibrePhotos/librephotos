import { ActionIcon, Alert, Button, Center, Code, Group, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { IconCopy as CopyIcon } from "@tabler/icons-react";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth/hooks";
import { useMediaDiagnosticsQuery } from "../../api_client/media";
import { copyToClipboard } from "../../util/util";

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
/** How far one press of a seek shortcut moves the playhead, in seconds. */
export const SEEK_STEP_SECONDS = 10;

/** The same, for the long jump on Ctrl -- VLC's split between the two. */
export const SEEK_LONG_STEP_SECONDS = 60;

/** "+10s", "-1m": whole minutes read better than "+60s" once past a minute. */
export function formatSeekDistance(seconds: number): string {
  const sign = seconds > 0 ? "+" : "-";
  const size = Math.abs(seconds);
  return size >= 60 && size % 60 === 0 ? `${sign}${size / 60}m` : `${sign}${size}s`;
}

/**
 * Seek requests arrive as a window event because the two halves of the gesture
 * live apart: the lightbox owns the keyboard -- its hotkeys are bound on
 * `document`, so they fire no matter what has focus -- while the `<video>`
 * element only ever exists in here. Threading a ref down through `MediaDisplay`
 * into a memoised player would couple three components to one keypress, and
 * the lightbox already talks to its controls this way. Only the main slide
 * renders a player, so exactly one listener is ever mounted.
 */
export const LIGHTBOX_SEEK_EVENT = "lightbox-seek";

export function requestLightboxSeek(seconds: number) {
  window.dispatchEvent(new CustomEvent(LIGHTBOX_SEEK_EVENT, { detail: { seconds } }));
}

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

/**
 * One line of the diagnosis. Kept as data rather than JSX because the same line
 * has to be both rendered and copied to the clipboard, and building those
 * separately is how the copied report silently stops matching the panel.
 */
export type DiagnosticFact = { label: string; code?: string; suffix?: string };

export function factToText({ label, code, suffix }: DiagnosticFact): string {
  return [label, code, suffix ? `- ${suffix}` : undefined].filter(Boolean).join(" ");
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
  const [copied, setCopied] = useState(false);
  const readyFiredRef = useRef(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every probe so a stale answer cannot overwrite a newer one after
  // the user has already navigated to a different video.
  const probeRef = useRef(0);
  // What the last seek shortcut did, shown briefly over the picture. A
  // keyboard-driven seek never raises the native control bar, so without this
  // the key produces no visible acknowledgement at all.
  const [seekHint, setSeekHint] = useState<{ seconds: number } | "unavailable" | null>(null);
  const seekHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setSeekHint(null);
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

  useEffect(() => {
    const showHint = (hint: { seconds: number } | "unavailable") => {
      setSeekHint(hint);
      if (seekHintTimerRef.current) clearTimeout(seekHintTimerRef.current);
      seekHintTimerRef.current = setTimeout(() => setSeekHint(null), 900);
    };

    const handleSeek = (event: Event) => {
      const video = videoRef.current;
      const seconds = (event as CustomEvent<{ seconds: number }>).detail?.seconds;
      if (!video || !seconds) return;
      // `seekable` is the honest bound, not `duration`. A video the backend is
      // transcoding on the fly is served as a chunked stream with no length and
      // no `Accept-Ranges`, so its duration reads as Infinity and the playhead
      // will not move however far we ask it to. Saying that out loud beats a
      // shortcut that silently does nothing.
      const { seekable } = video;
      if (!seekable || seekable.length === 0) {
        showHint("unavailable");
        return;
      }
      video.currentTime = Math.min(
        Math.max(video.currentTime + seconds, seekable.start(0)),
        seekable.end(seekable.length - 1)
      );
      showHint({ seconds });
    };

    window.addEventListener(LIGHTBOX_SEEK_EVENT, handleSeek);
    return () => window.removeEventListener(LIGHTBOX_SEEK_EVENT, handleSeek);
  }, []);

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      if (seekHintTimerRef.current) clearTimeout(seekHintTimerRef.current);
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
      .filter(Boolean)
      .forEach(key => facts.push({ label: t(`lightbox.videoerror.${key}`) }));
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
      url,
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
          <Loader color="white" size="lg" />
        </Center>
      )}
      {seekHint !== null && (
        <Center style={{ position: "absolute", inset: 0, zIndex: 2, pointerEvents: "none" }}>
          <Text
            size="xl"
            fw={600}
            c="white"
            style={{ background: "rgba(0,0,0,0.65)", borderRadius: 8, padding: "8px 16px" }}
          >
            {seekHint === "unavailable" ? t("lightbox.video.seekunavailable") : formatSeekDistance(seekHint.seconds)}
          </Text>
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
