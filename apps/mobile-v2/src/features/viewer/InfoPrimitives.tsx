import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon, type IconName } from "@/components/Icon";
import { useTheme, type ThemeColors } from "@/theme";

/**
 * Shared building blocks for the viewer's info sheet (doc 07 §3).
 *
 * The rule these encode: **no section ever renders blank.** Every one of them
 * has three states — content, "nothing here", and "needs a connection" / "not
 * synced yet" — because an empty gap reads as "this photo has no camera", which
 * is a different and usually wrong claim from "we could not load it".
 */

export function Section({
  title,
  icon,
  action,
  children,
  testID,
}: {
  title: string;
  icon: IconName;
  /** Optional trailing control (edit, add, …). */
  action?: ReactNode;
  children: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        paddingVertical: 14,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name={icon} size={18} color={theme.muted} />
        <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15, flex: 1 }}>{title}</Text>
        {action}
      </View>
      {children}
    </View>
  );
}

/** A label/value pair. Renders nothing at all when there is no value — callers
 *  that must never disappear use `Note` instead. */
export function InfoRow({
  label,
  value,
  testID,
}: {
  label: string;
  value: string | null | undefined;
  testID?: string;
}) {
  const theme = useTheme();
  if (value == null || value === "") return null;
  return (
    <View testID={testID} style={{ flexDirection: "row", gap: 12, paddingVertical: 3 }}>
      <Text style={{ color: theme.muted, width: 132, fontSize: 13 }}>{label}</Text>
      <Text selectable style={{ color: theme.text, flex: 1, fontSize: 13 }}>
        {value}
      </Text>
    </View>
  );
}

export type NoteTone = "muted" | "offline";

/** The explicit "nothing here" / "needs a connection" state of a section. */
export function Note({
  text,
  tone = "muted",
  testID,
}: {
  text: string;
  tone?: NoteTone;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {tone === "offline" ? <Icon name="offline" size={14} color={theme.muted} /> : null}
      <Text testID={testID} style={{ color: theme.muted, fontSize: 13, flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

/** A tappable pill. Used for scene tags, keywords-style chips and people. */
export function Chip({
  label,
  onPress,
  active,
  disabled,
  testID,
  leading,
}: {
  label: string;
  onPress?: () => void;
  active?: boolean;
  disabled?: boolean;
  testID?: string;
  leading?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, selected: !!active }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        minHeight: 34,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 17,
        borderWidth: 1,
        borderColor: active ? theme.brand : theme.border,
        backgroundColor: active ? theme.brand : theme.background,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {leading}
      <Text
        numberOfLines={1}
        style={{ color: active ? "#fff" : theme.text, fontSize: 13, fontWeight: "600" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A small text button that keeps a ≥44pt hit target via `hitSlop`. */
export function LinkButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={12}
      style={{ minHeight: 24, justifyContent: "center", opacity: disabled ? 0.45 : 1 }}
    >
      <Text style={{ color: disabled ? theme.muted : theme.brand, fontWeight: "600", fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A control that is only legal online. Renders disabled with the standard
 * `offline.needsConnection` explanation appended, never silently inert — the
 * same contract the grid's `SelectionActionBar` already honours.
 */
export function OnlineOnlyButton({
  label,
  onPress,
  isOnline,
  testID,
}: {
  label: string;
  onPress?: () => void;
  isOnline: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <LinkButton
      testID={testID}
      label={isOnline ? label : `${label} · ${t("offline.needsConnection")}`}
      onPress={onPress}
      disabled={!isOnline}
    />
  );
}

/** A "Show more / Show less" disclosure around extra detail rows. */
export function Disclosure({
  children,
  testID,
}: {
  children: ReactNode;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {open ? <View testID={testID ? `${testID}-content` : undefined}>{children}</View> : null}
      <Pressable
        testID={testID}
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        hitSlop={12}
        style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28 }}
      >
        <Text style={{ color: theme.brand, fontWeight: "600", fontSize: 13 }}>
          {open ? t("viewer.showLess") : t("viewer.showMore")}
        </Text>
        <Icon name={open ? "collapse" : "expand"} size={14} color={theme.brand} />
      </Pressable>
    </View>
  );
}

export function chipRowStyle(): { flexDirection: "row"; flexWrap: "wrap"; gap: number } {
  return { flexDirection: "row", flexWrap: "wrap", gap: 8 };
}

export type { ThemeColors };
