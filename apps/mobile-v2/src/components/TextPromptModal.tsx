import { useEffect, useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/theme";

/**
 * A minimal titled text-input dialog reused for caption edit, album rename,
 * person rename, and new-album name. Presentational — the caller owns the
 * mutation on `onSubmit`.
 */
export function TextPromptModal({
  visible,
  title,
  placeholder,
  initialValue = "",
  submitLabel,
  multiline = false,
  onSubmit,
  onCancel,
  testID = "text-prompt",
}: {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel: string;
  multiline?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable
        onPress={onCancel}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 }}
      >
        <Pressable
          testID={testID}
          onPress={() => {}}
          style={{ backgroundColor: theme.card, borderRadius: 14, padding: 18, gap: 12 }}
        >
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>{title}</Text>
          <TextInput
            testID={`${testID}-input`}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={theme.muted}
            multiline={multiline}
            autoFocus
            style={{
              color: theme.text,
              borderColor: theme.border,
              borderWidth: 1,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              minHeight: multiline ? 80 : undefined,
              textAlignVertical: multiline ? "top" : "center",
            }}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 16 }}>
            <Pressable testID={`${testID}-cancel`} onPress={onCancel} hitSlop={8}>
              <Text style={{ color: theme.muted, fontWeight: "600" }}>{t("mutations.cancel")}</Text>
            </Pressable>
            <Pressable
              testID={`${testID}-submit`}
              onPress={() => onSubmit(value.trim())}
              disabled={value.trim().length === 0}
              hitSlop={8}
            >
              <Text style={{ color: value.trim().length === 0 ? theme.muted : theme.brand, fontWeight: "700" }}>
                {submitLabel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
