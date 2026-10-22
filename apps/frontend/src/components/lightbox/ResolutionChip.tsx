import { Anchor, Group, Progress, Text, UnstyledButton } from "@mantine/core";
import { useTimeout } from "@mantine/hooks";
import { IconAlertTriangle, IconDownload, IconPhoto } from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OriginalZoomPlan, PixelSize, PreviewReason } from "./originalZoom";
import classes from "./ResolutionChip.module.css";
import type { OriginalImageStatus } from "./useOriginalImage";

/** What the chip says: the zoom plan and, while loading the original, how that went. */
export type ChipState =
  | { kind: "loading" }
  | { kind: "original"; size: PixelSize | null }
  | { kind: "failed" }
  | { kind: "preview"; reason: PreviewReason };

export function chipState(
  plan: OriginalZoomPlan,
  original: { status: OriginalImageStatus; size: PixelSize | null }
): ChipState | null {
  switch (plan.kind) {
    case "none":
      return null;
    case "original":
    case "preview":
      return plan;
    case "load":
      if (original.status === "loaded") return { kind: "original", size: original.size };
      return original.status === "failed" ? { kind: "failed" } : { kind: "loading" };
  }
}

/** How long the chip names the size before it shrinks to "Original". */
const SIZE_SHOWN_MS = 2000;

type Props = Readonly<{
  state: ChipState;
  /** Shown only while the photo is zoomed; mounted throughout, so it shrinks only once. */
  visible: boolean;
  onRetry: () => void;
  downloadUrl: string;
}>;

/**
 * A pill in the photo's lower-left corner while zoomed in (#2742): the
 * original loading, the original shown (with its size for two seconds), why
 * the zoom stays on the preview, or that the original did not load.
 */
export function ResolutionChip({ state, visible, onRetry, downloadUrl }: Props) {
  const [compact, setCompact] = useState(false);
  const sized = visible && state.kind === "original" && state.size !== null;
  const { start, clear } = useTimeout(() => setCompact(true), SIZE_SHOWN_MS);
  useEffect(() => {
    if (sized) start();
    return clear;
  }, [sized, start, clear]);

  if (!visible) return null;
  return (
    <div className={classes.chip} role="status">
      <ChipContent state={state} compact={compact} onRetry={onRetry} downloadUrl={downloadUrl} />
    </div>
  );
}

function ChipContent({
  state,
  compact,
  onRetry,
  downloadUrl,
}: Readonly<Omit<Props, "visible"> & { compact: boolean }>) {
  const { t } = useTranslation();
  switch (state.kind) {
    case "loading":
      return (
        <div>
          <Text size="xs">{t("lightbox.original.loading")}</Text>
          <Progress value={100} striped animated size={3} mt={4} aria-hidden />
        </div>
      );
    case "original":
      return (
        <Group gap={6} wrap="nowrap">
          <span className={classes.dot} />
          <Text size="xs">
            {state.size && !compact
              ? t("lightbox.original.shownsize", { width: state.size.width, height: state.size.height })
              : t("lightbox.original.shown")}
          </Text>
        </Group>
      );
    case "failed":
      return (
        <Group gap={6} wrap="nowrap">
          <IconAlertTriangle size={14} className={classes.warning} aria-hidden />
          <Text size="xs">{t("lightbox.original.failed")}</Text>
          <UnstyledButton className={classes.action} onClick={onRetry}>
            {t("lightbox.original.retry")}
          </UnstyledButton>
        </Group>
      );
    case "preview":
      return (
        <Group gap={6} wrap="nowrap">
          <IconPhoto size={14} aria-hidden />
          <Text size="xs">
            {t("lightbox.original.preview")} · {t(`lightbox.original.reason.${state.reason}`)}
          </Text>
          <Anchor href={downloadUrl} download className={classes.action} aria-label={t("lightbox.original.download")}>
            <IconDownload size={12} aria-hidden /> {t("lightbox.original.shown")}
          </Anchor>
        </Group>
      );
  }
}
