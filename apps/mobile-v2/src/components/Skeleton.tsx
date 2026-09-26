import { View, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";

/**
 * A static placeholder block used while the SQLite mirror is still seeding.
 *
 * Deliberately unanimated: a looping `Animated` value would keep a timer alive
 * for the lifetime of the screen and leak into jest's fake-timer / open-handle
 * accounting for every test that renders one. A flat tinted block reads as
 * "content is coming" just as well on a phone.
 */
export function Skeleton({
  width,
  height,
  radius = 8,
  style,
  testID,
}: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: ViewStyle;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[{ width, height, borderRadius: radius, backgroundColor: theme.card, opacity: 0.7 }, style]}
    />
  );
}
