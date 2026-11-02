import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "./Icon";
import { useTheme } from "@/theme";

const DANGER = "#dc2626";

/** One row of an {@link OptionSheet}. */
export type SheetOption = {
  key: string;
  label: string;
  icon?: IconName;
  onPress: () => void;
  /** Drawn in red: deletes something. */
  destructive?: boolean;
  /** A radio-style choice that is in effect (a check at the end). */
  selected?: boolean;
  disabled?: boolean;
  /** Why it is disabled, under the label (e.g. "needs a connection"). */
  hint?: string;
  testID?: string;
};

/**
 * A phone-style action sheet: a title, a list of rows, and Cancel, sliding up
 * over a dimmed backdrop. Used for the "⋯" menus and the sort menu, where the
 * web shows a dropdown. `children` render above the rows (a star picker, say).
 */
export function OptionSheet({
  visible,
  title,
  options,
  onClose,
  children,
  testID = "option-sheet",
}: {
  visible: boolean;
  title: string;
  options: SheetOption[];
  onClose: () => void;
  children?: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <Pressable
          testID={testID}
          onPress={() => {}}
          style={{
            backgroundColor: theme.card,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 28,
            maxHeight: "80%",
          }}
        >
          <Text style={{ color: theme.text, fontWeight: "700", fontSize: 16, marginBottom: 8 }}>{title}</Text>
          <ScrollView>
            {children}
            {options.map((option) => {
              const color = option.disabled ? theme.muted : option.destructive ? DANGER : theme.text;
              return (
                <Pressable
                  key={option.key}
                  testID={option.testID ?? `${testID}-${option.key}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!option.disabled, selected: !!option.selected }}
                  disabled={option.disabled}
                  onPress={option.onPress}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 14,
                    borderBottomColor: theme.border,
                    borderBottomWidth: 1,
                    opacity: option.disabled ? 0.6 : 1,
                  }}
                >
                  {option.icon ? <Icon name={option.icon} size={20} color={color} /> : null}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color, fontSize: 15 }}>{option.label}</Text>
                    {option.hint ? <Text style={{ color: theme.muted, fontSize: 12 }}>{option.hint}</Text> : null}
                  </View>
                  {option.selected ? <Icon name="check" size={20} color={theme.brand} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            testID={`${testID}-cancel`}
            onPress={onClose}
            style={{ paddingTop: 14, alignItems: "center" }}
          >
            <Text style={{ color: theme.brand, fontWeight: "600" }}>{t("common.cancel")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
