import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useReactiveQuery } from "@/db/provider";
import { EMPTY_LIBRARY_STATS, libraryStats } from "@librephotos/local-db";
import { useTheme } from "@/theme";

/** "Library stats" card on the profile — mirror counts, offline-safe (doc 05 §8). */
export function StatsCard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { data: stats } = useReactiveQuery(["library-stats"], (db) => libraryStats(db), EMPTY_LIBRARY_STATS);

  const cells: { key: keyof typeof stats; label: string }[] = [
    { key: "photos", label: t("stats.photos") },
    { key: "videos", label: t("stats.videos") },
    { key: "people", label: t("stats.people") },
    { key: "albums", label: t("stats.albums") },
    { key: "places", label: t("stats.places") },
    { key: "favorites", label: t("stats.favorites") },
  ];

  return (
    <View
      testID="stats-card"
      style={{ backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 16 }}
    >
      <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16, marginBottom: 12 }}>{t("stats.title")}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {cells.map((c) => (
          <View key={c.key} testID={`stat-${c.key}`} style={{ width: "33%", paddingVertical: 8 }}>
            <Text style={{ color: theme.text, fontSize: 22, fontWeight: "700" }}>{stats[c.key]}</Text>
            <Text style={{ color: theme.muted, fontSize: 12 }}>{c.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
