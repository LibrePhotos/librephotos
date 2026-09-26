import { Pressable, TextInput, View } from "react-native";
import { Icon } from "./Icon";
import { useTheme } from "@/theme";

/**
 * The app's search input: a rounded field with a leading magnifier and a
 * trailing clear button that only appears once there is something to clear.
 * The field itself is 48pt tall and the clear button carries hit-slop, so both
 * targets clear the 44pt minimum.
 */
export function SearchField({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  clearAccessibilityLabel,
  testID = "search-input",
  clearTestID = "search-clear",
  autoFocus = false,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit?: () => void;
  placeholder: string;
  clearAccessibilityLabel: string;
  testID?: string;
  clearTestID?: string;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: 48,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: theme.card,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Icon name="search" size={18} color={theme.muted} />
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        returnKeyType="search"
        clearButtonMode="never"
        onSubmitEditing={onSubmit}
        accessibilityLabel={placeholder}
        style={{ flex: 1, color: theme.text, fontSize: 16, paddingVertical: 12 }}
      />
      {value.length > 0 ? (
        <Pressable
          testID={clearTestID}
          accessibilityRole="button"
          accessibilityLabel={clearAccessibilityLabel}
          hitSlop={12}
          onPress={() => onChangeText("")}
        >
          <Icon name="clear" size={18} color={theme.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}
