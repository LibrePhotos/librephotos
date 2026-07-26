import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useRouter, type Href } from "expo-router";
import { mediaHeaders, squareThumbnailUrl } from "@librephotos/api-client";
import { Icon, type IconName } from "./Icon";
import { Skeleton } from "./Skeleton";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";

/** One preview entry in a section's horizontal strip. */
export type ExploreItem = {
  id: string | number;
  title: string;
  coverHash: string | null;
  /** Omitted for people (a face count is not a photo count). */
  photoCount?: number | null;
  href: Href;
};

export type ExploreSectionProps = {
  /** Stable slug used for testIDs: `explore-section-<key>`. */
  sectionKey: string;
  title: string;
  icon: IconName;
  /** Localized "N albums" / "N people" line under the title. */
  countLabel: string;
  viewAllHref: Href;
  items: ExploreItem[];
  /** Mirror has never finished seeding this entity → show placeholders. */
  isSeeding?: boolean;
  emptyMessage: string;
  /** Replaces the strip entirely (e.g. Folders while offline). */
  notice?: string;
  /** Secondary affordance next to the header (People → "Manage Faces"). */
  action?: { label: string; icon: IconName; href: Href };
  variant?: "card" | "avatar";
  maxItems?: number;
};

const CARD = 132;
const AVATAR = 68;

/**
 * One row of the Albums "Explore" hub, mirroring the web frontend's
 * `AlbumSection`: a category icon, a title, a live count, a "View all ›"
 * affordance, and a horizontal strip of preview cards.
 *
 * Every state the first-run app can be in is represented — seeding (skeletons),
 * empty ("No albums yet"), online-only (a notice), and populated — so a section
 * is never a blank gap.
 */
export function ExploreSection({
  sectionKey,
  title,
  icon,
  countLabel,
  viewAllHref,
  items,
  isSeeding = false,
  emptyMessage,
  notice,
  action,
  variant = "card",
  maxItems = 12,
}: ExploreSectionProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const shown = items.slice(0, maxItems);

  return (
    <View testID={`explore-section-${sectionKey}`} style={{ paddingVertical: 8 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          gap: 12,
        }}
      >
        <Pressable
          testID={`explore-viewall-${sectionKey}`}
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${countLabel}, ${t("explore.viewAll")}`}
          onPress={() => router.push(viewAllHref)}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1, minHeight: 48 }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: theme.card,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name={icon} size={22} color={theme.brand} />
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text numberOfLines={1} style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>
              {title}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text testID={`explore-count-${sectionKey}`} style={{ color: theme.muted, fontSize: 13 }}>
                {countLabel}
              </Text>
              <Text style={{ color: theme.muted, fontSize: 13 }}>·</Text>
              <Text style={{ color: theme.brand, fontSize: 13, fontWeight: "600" }}>{t("explore.viewAll")}</Text>
              <Icon name="viewAll" size={14} color={theme.brand} />
            </View>
          </View>
        </Pressable>

        {action ? (
          <Pressable
            testID={`explore-action-${sectionKey}`}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => router.push(action.href)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              minHeight: 44,
              paddingHorizontal: 12,
              borderRadius: 20,
              backgroundColor: theme.card,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Icon name={action.icon} size={16} color={theme.brand} />
            <Text style={{ color: theme.brand, fontSize: 13, fontWeight: "600" }}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>

      <SectionBody
        sectionKey={sectionKey}
        items={shown}
        isSeeding={isSeeding}
        emptyMessage={emptyMessage}
        notice={notice}
        variant={variant}
      />
    </View>
  );
}

function SectionBody({
  sectionKey,
  items,
  isSeeding,
  emptyMessage,
  notice,
  variant,
}: {
  sectionKey: string;
  items: ExploreItem[];
  isSeeding: boolean;
  emptyMessage: string;
  notice?: string;
  variant: "card" | "avatar";
}) {
  const theme = useTheme();

  if (notice) {
    return (
      <View
        testID={`explore-notice-${sectionKey}`}
        style={{ marginTop: 10, marginHorizontal: 16, padding: 16, borderRadius: 12, backgroundColor: theme.card }}
      >
        <Text style={{ color: theme.muted, fontSize: 13 }}>{notice}</Text>
      </View>
    );
  }

  if (items.length === 0 && isSeeding) {
    return (
      <ScrollView
        testID={`explore-skeleton-${sectionKey}`}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, gap: 10 }}
      >
        {[0, 1, 2, 3].map(i => (
          <View key={i} style={{ gap: 6 }}>
            <Skeleton
              width={variant === "avatar" ? AVATAR : CARD}
              height={variant === "avatar" ? AVATAR : CARD}
              radius={variant === "avatar" ? AVATAR / 2 : 12}
            />
            <Skeleton width={variant === "avatar" ? AVATAR : 90} height={10} radius={4} />
          </View>
        ))}
      </ScrollView>
    );
  }

  if (items.length === 0) {
    return (
      <View
        testID={`explore-empty-${sectionKey}`}
        style={{ marginTop: 10, marginHorizontal: 16, padding: 16, borderRadius: 12, backgroundColor: theme.card }}
      >
        <Text style={{ color: theme.muted, fontSize: 13 }}>{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      testID={`explore-strip-${sectionKey}`}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, gap: 10 }}
    >
      {items.map(item => (
        <ExploreCard key={`${sectionKey}-${item.id}`} sectionKey={sectionKey} item={item} variant={variant} />
      ))}
    </ScrollView>
  );
}

function ExploreCard({
  sectionKey,
  item,
  variant,
}: {
  sectionKey: string;
  item: ExploreItem;
  variant: "card" | "avatar";
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { base, headers } = useMediaSource();
  const size = variant === "avatar" ? AVATAR : CARD;
  const radius = variant === "avatar" ? size / 2 : 12;
  const uri = item.coverHash ? squareThumbnailUrl(base, item.coverHash) : null;

  return (
    <Pressable
      testID={`explore-item-${sectionKey}-${item.id}`}
      accessibilityRole="button"
      accessibilityLabel={item.title}
      onPress={() => router.push(item.href)}
      style={{ width: size, alignItems: variant === "avatar" ? "center" : "flex-start" }}
    >
      {uri ? (
        <Image
          testID={`explore-cover-${sectionKey}-${item.id}`}
          style={{ width: size, height: size, borderRadius: radius, backgroundColor: theme.card }}
          source={{ uri, headers }}
          contentFit="cover"
          cachePolicy="disk"
        />
      ) : (
        <View
          testID={`explore-nocover-${sectionKey}-${item.id}`}
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: theme.card,
            borderWidth: 1,
            borderColor: theme.border,
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
          }}
        >
          <Icon name="photo" size={variant === "avatar" ? 22 : 26} color={theme.muted} />
          {variant === "card" ? (
            <Text style={{ color: theme.muted, fontSize: 11 }}>{t("explore.noCover")}</Text>
          ) : null}
        </View>
      )}
      <Text
        numberOfLines={1}
        style={{
          color: theme.text,
          fontSize: 13,
          fontWeight: "600",
          marginTop: 6,
          maxWidth: size,
          textAlign: variant === "avatar" ? "center" : "left",
        }}
      >
        {item.title}
      </Text>
      {item.photoCount != null ? (
        <Text style={{ color: theme.muted, fontSize: 11 }}>
          {t("explore.photoCount", { count: item.photoCount })}
        </Text>
      ) : null}
    </Pressable>
  );
}

/* Media base/headers are read per card by this tiny hook, so a section stays a
   plain presentational component that a test can render on its own. */
function useMediaSource() {
  const token = useAccessToken();
  const base = serverAddress();
  const headers = useMemo(() => mediaHeaders(token), [token]);
  return { base, headers };
}
