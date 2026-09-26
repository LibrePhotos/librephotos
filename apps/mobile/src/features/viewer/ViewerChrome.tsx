import { useEffect, useRef } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { squareThumbnailSmallUrl } from "@librephotos/api-client";
import { Icon, type IconName } from "@/components/Icon";
import type { ViewerSlide } from "@/db/queries/detail";

/**
 * The viewer's overlay chrome: a top bar and a thumbnail filmstrip.
 *
 * Both sit on translucent scrims over an arbitrary photo, so — uniquely in this
 * app — they use fixed on-scrim colours instead of `useTheme()` text colours. A
 * theme-coloured label is unreadable on roughly half of all photographs. The
 * exception is deliberate and confined to this file and `ViewerActionBar`.
 */

const ON_SCRIM = "#ffffff";
const SCRIM = "rgba(0,0,0,0.45)";

/** 44pt-square icon button, the platform minimum touch target. */
export function ChromeButton({
  icon,
  label,
  onPress,
  active,
  disabled,
  testID,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  active?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={{
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 22,
        backgroundColor: active ? "rgba(255,255,255,0.22)" : "transparent",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name={icon} size={22} color={ON_SCRIM} />
    </Pressable>
  );
}

export function ViewerTopBar({
  title,
  subtitle,
  topInset,
  onClose,
  onToggleInfo,
  infoOpen,
  testID = "viewer-top-bar",
}: {
  title: string;
  subtitle?: string | null;
  topInset: number;
  onClose: () => void;
  onToggleInfo: () => void;
  infoOpen: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <View
      testID={testID}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: topInset,
        paddingHorizontal: 4,
        paddingBottom: 6,
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: SCRIM,
      }}
    >
      <ChromeButton testID="viewer-close" icon="back" label={t("common.close")} onPress={onClose} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: ON_SCRIM, fontWeight: "700", fontSize: 15 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: "rgba(255,255,255,0.75)", fontSize: 12 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <ChromeButton
        testID="viewer-info"
        icon="info"
        label={t("viewer.info")}
        onPress={onToggleInfo}
        active={infoOpen}
      />
    </View>
  );
}

const THUMB = 52;

/**
 * A filmstrip of the pager's own window.
 *
 * The web lightbox shows exactly three tiles (prev / current / next) because a
 * mouse clicks arrows. On a phone the swipe is the primary gesture and the
 * filmstrip's job is *orientation* — where am I in this day — so it scrolls the
 * whole window and keeps the active slide centred.
 */
export function ThumbnailStrip({
  slides,
  activeKey,
  serverAddress,
  headers,
  bottomOffset,
  onSelect,
  testID = "viewer-filmstrip",
}: {
  slides: ViewerSlide[];
  activeKey: string | undefined;
  serverAddress: string;
  headers: Record<string, string>;
  bottomOffset: number;
  onSelect: (index: number) => void;
  testID?: string;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const activeIndex = slides.findIndex((s) => s.key === activeKey);

  useEffect(() => {
    if (activeIndex < 0) return;
    // Keep the active tile roughly centred as the pager moves.
    scrollRef.current?.scrollTo({ x: Math.max(0, (activeIndex - 2) * (THUMB + 6)), animated: true });
  }, [activeIndex]);

  if (slides.length <= 1) return null;

  return (
    <View
      testID={testID}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: bottomOffset,
        paddingVertical: 8,
        backgroundColor: SCRIM,
      }}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}
      >
        {slides.map((slide, index) => {
          const active = slide.key === activeKey;
          const uri = slide.local_uri
            ? slide.local_uri
            : slide.image_hash
              ? squareThumbnailSmallUrl(serverAddress, slide.image_hash)
              : null;
          return (
            <Pressable
              key={slide.key}
              testID={`viewer-filmstrip-${slide.key}`}
              onPress={() => onSelect(index)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: 6,
                overflow: "hidden",
                borderWidth: active ? 2 : 1,
                borderColor: active ? ON_SCRIM : "rgba(255,255,255,0.35)",
                opacity: active ? 1 : 0.7,
              }}
            >
              <Image
                source={uri ? { uri, headers: slide.local_uri ? undefined : headers } : undefined}
                style={{ width: "100%", height: "100%", backgroundColor: "rgba(255,255,255,0.1)" }}
                contentFit="cover"
                cachePolicy="disk"
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
