import { useMemo, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FlashList } from "@shopify/flash-list";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { mediaHeaders, squareThumbnailUrl } from "@librephotos/api-client";
import { useReactiveQuery } from "@/db/provider";
import { people, type PersonRow } from "@/db/queries/people";
import { TextPromptModal } from "@/components/TextPromptModal";
import { useMutations } from "@/mutations/useMutations";
import { useAccessToken } from "@/hooks/use-access-token";
import { serverAddress } from "@/lib/apiClient";
import { useTheme } from "@/theme";

/** The People album grid, rendered from the mirrored `person` list (doc 02). */
export function PeopleScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const token = useAccessToken();
  const base = serverAddress();
  const mutations = useMutations();
  const { width } = useWindowDimensions();
  const size = useMemo(() => Math.floor((width - 64) / 3), [width]);
  const headers = useMemo(() => mediaHeaders(token), [token]);
  const persons = useReactiveQuery((db) => people(db), []);
  const [renaming, setRenaming] = useState<PersonRow | null>(null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={["top"]}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: "700", color: theme.text }}>{t("explore.people")}</Text>
      </View>
      <FlashList
        testID="people-list"
        data={persons}
        numColumns={3}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={
          <View testID="people-empty" style={{ padding: 32, alignItems: "center" }}>
            <Text style={{ color: theme.muted }}>{t("explore.noPeople")}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            testID={`person-${item.id}`}
            onPress={() => router.push(`/albums/people/${item.id}`)}
            onLongPress={() => setRenaming(item)}
            delayLongPress={250}
            style={{ width: size, alignItems: "center", margin: 6 }}
          >
            <Image
              testID={`person-cover-${item.id}`}
              style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.card }}
              source={item.cover_photo_hash ? { uri: squareThumbnailUrl(base, item.cover_photo_hash), headers } : undefined}
              contentFit="cover"
              cachePolicy="disk"
            />
            <Text numberOfLines={1} style={{ color: theme.text, marginTop: 6, fontSize: 12 }}>
              {item.name ?? t("faces.unknown")}
            </Text>
          </Pressable>
        )}
      />
      <TextPromptModal
        visible={renaming != null}
        title={t("mutations.renamePerson")}
        placeholder={t("mutations.personName")}
        initialValue={renaming?.name ?? ""}
        submitLabel={t("mutations.rename")}
        testID="person-rename-prompt"
        onSubmit={(value) => {
          const target = renaming;
          setRenaming(null);
          if (target && value && value !== target.name) mutations.renamePerson(target.id, value);
        }}
        onCancel={() => setRenaming(null)}
      />
    </SafeAreaView>
  );
}
