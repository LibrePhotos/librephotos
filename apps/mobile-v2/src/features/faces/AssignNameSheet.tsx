import { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useReactiveQuery } from "@/db/provider";
import { people } from "@/db/queries/people";
import { useTheme } from "@/theme";

/**
 * Assign-name sheet for face tagging. Autocompletes against the mirrored
 * `person` list (offline-safe) as the user types, and offers "New person" with
 * the typed name. The actual labelFaces call is online-only (caller-owned).
 */
export function AssignNameSheet({
  visible,
  onAssign,
  onCancel,
}: {
  visible: boolean;
  onAssign: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [text, setText] = useState("");
  const persons = useReactiveQuery((db) => people(db), []);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const named = persons.filter((p) => p.name && p.name.toLowerCase() !== "unknown");
    if (!q) return named.slice(0, 30);
    return named.filter((p) => p.name!.toLowerCase().includes(q)).slice(0, 30);
  }, [persons, text]);

  const exact = matches.some((p) => p.name!.toLowerCase() === text.trim().toLowerCase());
  const canCreate = text.trim().length > 0 && !exact;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable onPress={onCancel} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <Pressable
          testID="assign-name-sheet"
          onPress={() => {}}
          style={{ backgroundColor: theme.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: "75%", gap: 8 }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16 }}>{t("faces.assignName")}</Text>
            <Pressable testID="assign-name-cancel" onPress={onCancel} hitSlop={8}>
              <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("common.cancel")}</Text>
            </Pressable>
          </View>
          <TextInput
            testID="assign-name-input"
            value={text}
            onChangeText={setText}
            placeholder={t("faces.personNamePlaceholder")}
            placeholderTextColor={theme.muted}
            autoFocus
            style={{ color: theme.text, borderColor: theme.border, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 }}
          />
          {canCreate ? (
            <Pressable
              testID="assign-name-create"
              onPress={() => onAssign(text.trim())}
              style={{ paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: 1 }}
            >
              <Text style={{ color: theme.brand, fontWeight: "700" }}>+ {t("faces.newPerson")}: {text.trim()}</Text>
            </Pressable>
          ) : null}
          <FlatList
            data={matches}
            keyExtractor={(p) => String(p.id)}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                testID={`assign-person-${item.id}`}
                onPress={() => onAssign(item.name!)}
                style={{ paddingVertical: 12, borderBottomColor: theme.border, borderBottomWidth: 1 }}
              >
                <Text style={{ color: theme.text }}>{item.name}</Text>
              </Pressable>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
