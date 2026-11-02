import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { endpoints, geocodeKeys, useApiClient, type GeocodeResult } from "@librephotos/api-client";
import { Icon } from "@/components/Icon";
import { useTheme } from "@/theme";
import { ModalSheet } from "./ViewerSheets";

/** How long typing must pause before the server's geocoder is asked. */
const SEARCH_DEBOUNCE_MS = 400;

/**
 * Edit a photo's location by searching for a place (the server's
 * `/geocode/search`, the same lookup the web's location picker uses), or remove
 * it. The web also lets you drag a pin on a map; Expo Go has no interactive
 * map beyond raster tiles, so a phone picks by name.
 *
 * Presentational apart from the search itself: the caller saves.
 */
export function LocationEditModal({
  visible,
  hasLocation,
  onPick,
  onRemove,
  onCancel,
}: {
  visible: boolean;
  /** Offers "Remove location" only when there is one. */
  hasLocation: boolean;
  onPick: (place: GeocodeResult) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet visible={visible} title={t("viewer.editLocation")} onClose={onCancel} testID="viewer-location-editor">
      <LocationSearch hasLocation={hasLocation} onPick={onPick} onRemove={onRemove} />
    </ModalSheet>
  );
}

/** The sheet's content; mounted on each opening, so every opening starts with an empty search. */
function LocationSearch({
  hasLocation,
  onPick,
  onRemove,
}: {
  hasLocation: boolean;
  onPick: (place: GeocodeResult) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const client = useApiClient();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const search = useQuery({
    queryKey: geocodeKeys.search(query),
    queryFn: () => endpoints.searchGeocode(client, query),
    enabled: query.length > 2,
    staleTime: 5 * 60 * 1000,
  });

  const confirmRemove = () => {
    Alert.alert(t("viewer.removeLocationTitle"), t("viewer.removeLocationMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("viewer.removeLocation"), style: "destructive", onPress: onRemove },
    ]);
  };

  const results = search.data ?? [];

  return (
    <>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 10,
          paddingHorizontal: 10,
          backgroundColor: theme.background,
        }}
      >
        <Icon name="search" size={18} color={theme.muted} />
        <TextInput
          testID="viewer-location-search"
          value={text}
          onChangeText={setText}
          placeholder={t("viewer.searchPlace")}
          placeholderTextColor={theme.muted}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => setQuery(text.trim())}
          style={{ flex: 1, minHeight: 44, color: theme.text, fontSize: 15 }}
        />
        {search.isFetching ? <ActivityIndicator size="small" color={theme.muted} /> : null}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 320 }}>
        {query.length > 2 && !search.isFetching && results.length === 0 ? (
          <Text testID="viewer-location-no-results" style={{ color: theme.muted, paddingVertical: 12 }}>
            {search.isError ? t("viewer.locationError") : t("viewer.noPlacesFound")}
          </Text>
        ) : null}
        {results.map((place, index) => (
          <Pressable
            key={`${place.lat},${place.lon},${index}`}
            testID={`viewer-location-result-${index}`}
            onPress={() => onPick(place)}
            accessibilityRole="button"
            style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingVertical: 6 }}
          >
            <Icon name="location" size={18} color={theme.muted} />
            <Text style={{ color: theme.text, fontSize: 14, flex: 1 }} numberOfLines={2}>
              {place.display_name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {hasLocation ? (
        <Pressable
          testID="viewer-location-remove"
          onPress={confirmRemove}
          accessibilityRole="button"
          style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48 }}
        >
          <Icon name="noLocation" size={20} color="#dc2626" />
          <Text style={{ color: "#dc2626", fontSize: 15, fontWeight: "600" }}>{t("viewer.removeLocation")}</Text>
        </Pressable>
      ) : null}
    </>
  );
}
