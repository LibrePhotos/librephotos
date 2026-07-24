import { Pressable, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link } from "expo-router";
import { useTheme } from "@/theme";

/**
 * Albums hub: People / Places / Things / My Albums / Events / Tags / Folders.
 * Each category screen is filled in during the feature-parity phase; the hub
 * itself is the navigation entry point.
 */
const CATEGORIES = [
  { label: "People", href: "/albums/people/all" },
  { label: "Places", href: "/albums/places/all" },
  { label: "Things", href: "/albums/things/all" },
  { label: "My Albums", href: "/albums/user/all" },
  { label: "Events", href: "/albums/events/all" },
  { label: "Tags", href: "/albums/tags/all" },
  { label: "Folders", href: "/albums/folders/root" },
] as const;

export default function AlbumsHubRoute() {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: theme.text, marginBottom: 8 }}>Albums</Text>
        {CATEGORIES.map((c) => (
          <Link key={c.label} href={c.href} asChild>
            <Pressable
              style={{
                paddingVertical: 16,
                paddingHorizontal: 16,
                borderRadius: 12,
                backgroundColor: theme.card,
                borderWidth: 1,
                borderColor: theme.border,
              }}
            >
              <Text style={{ color: theme.text, fontSize: 16, fontWeight: "500" }}>{c.label}</Text>
            </Pressable>
          </Link>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
