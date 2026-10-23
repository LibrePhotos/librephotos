import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { formatBytes } from "@/lib/format";
import type { SlideSource } from "./originalSource";
import type { OriginalLoad } from "./useOriginalOnZoom";

/**
 * On-scrim colours like the rest of the viewer chrome (`ViewerChrome.tsx`): the
 * chip sits on an arbitrary photo, so it is the same in both colour schemes.
 */
const ON_SCRIM = "#ffffff";
const SCRIM = "rgba(0,0,0,0.65)";
const LOADED_DOT = "#51cf66";
const ACTION = "#74c0fc";

/** How long the chip names the size before it shrinks to "Original". */
const SIZE_SHOWN_MS = 2000;

type Props = {
  source: SlideSource;
  load: OriginalLoad;
  /** Zoomed in with the chrome showing; the chip stays mounted otherwise, so it shrinks once. */
  visible: boolean;
  bottom: number;
  onRetry: () => void;
};

/**
 * The resolution chip above the filmstrip while zoomed in (#2743): the
 * original loading (with the bytes so far), the original shown (with its size
 * for two seconds), why the zoom stays on the preview, or that it failed.
 */
export function ResolutionChip({ source, load, visible, bottom, onRetry }: Props) {
  const [compact, setCompact] = useState(false);
  const sized = visible && load.status === "loaded" && load.size !== null;
  useEffect(() => {
    if (!sized) return;
    const timer = setTimeout(() => setCompact(true), SIZE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [sized]);

  if (!visible || source.kind === "thumbnail" || (source.kind === "original" && !source.zoom)) return null;
  return (
    <View
      testID="viewer-resolution-chip"
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={{
        position: "absolute",
        left: 12,
        bottom,
        maxWidth: "80%",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: SCRIM,
      }}
    >
      {source.kind === "preview" ? (
        <PreviewLabel reason={source.reason} />
      ) : (
        <OriginalLabel load={load} compact={compact} onRetry={onRetry} />
      )}
    </View>
  );
}

function ChipText({ children }: { children: string }) {
  return <Text style={{ color: ON_SCRIM, fontSize: 12, flexShrink: 1 }}>{children}</Text>;
}

function PreviewLabel({ reason }: { reason: Extract<SlideSource, { kind: "preview" }>["reason"] }) {
  const { t } = useTranslation();
  return <ChipText>{`${t("viewer.originalPreview")} · ${t(`viewer.originalReason.${reason}`)}`}</ChipText>;
}

function OriginalLabel({ load, compact, onRetry }: { load: OriginalLoad; compact: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  switch (load.status) {
    case "loading":
      return (
        <View style={{ flexShrink: 1 }}>
          <ChipText>
            {load.total > 0
              ? t("viewer.originalLoadingBytes", { loaded: formatBytes(load.loaded), total: formatBytes(load.total) })
              : t("viewer.originalLoading")}
          </ChipText>
          <View style={{ height: 2, marginTop: 3, borderRadius: 1, backgroundColor: "rgba(255,255,255,0.25)" }}>
            <View
              style={{
                height: 2,
                borderRadius: 1,
                backgroundColor: ACTION,
                width: `${load.total > 0 ? Math.round((load.loaded / load.total) * 100) : 0}%`,
              }}
            />
          </View>
        </View>
      );
    case "loaded":
      return (
        <>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: LOADED_DOT }} />
          <ChipText>
            {load.size && !compact
              ? t("viewer.originalSize", { width: load.size.width, height: load.size.height })
              : t("viewer.original")}
          </ChipText>
        </>
      );
    case "failed":
      return (
        <>
          <ChipText>{t("viewer.originalFailed")}</ChipText>
          <Pressable
            testID="viewer-original-retry"
            onPress={onRetry}
            accessibilityRole="button"
            hitSlop={12}
          >
            <Text style={{ color: ACTION, fontSize: 12, fontWeight: "700" }}>{t("viewer.originalRetry")}</Text>
          </Pressable>
        </>
      );
  }
}
