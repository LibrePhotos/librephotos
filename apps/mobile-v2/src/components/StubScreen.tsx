import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/theme";

/**
 * Placeholder for routes that exist in the routing map but are implemented in a
 * later phase. Keeps the navigation tree complete and typechecked today.
 */
export function StubScreen({ title, note }: { title: string; note?: string }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 }}>
        <Text style={{ color: theme.text, fontSize: 20, fontWeight: "600" }}>{title}</Text>
        <Text style={{ color: theme.muted, textAlign: "center" }}>{note ?? "Coming in a later phase."}</Text>
      </View>
    </SafeAreaView>
  );
}
