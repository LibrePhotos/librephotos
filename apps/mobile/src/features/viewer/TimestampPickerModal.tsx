import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerChangeEvent } from "@react-native-community/datetimepicker";
import { useTranslation } from "react-i18next";
import { formatFullDate } from "@/lib/format";
import { useResolvedScheme, useTheme } from "@/theme";
import { ModalSheet } from "./ViewerSheets";
import { pickerInitialDate } from "./timestamp";

/**
 * Edit a photo's date and time with the platform pickers
 * (`@react-native-community/datetimepicker`, bundled in Expo Go).
 *
 * iOS draws its date-and-time wheel inline in a sheet with Save. Android has
 * no inline picker, only its date and time dialogs, so there it opens them one
 * after the other with no sheet underneath, like the system Photos apps: OK on
 * the time dialog saves, cancelling either one changes nothing. Stacking the
 * system dialog on top of our own modal sheet left React Native's touch
 * handling stuck after both closed (every tap in the app went dead).
 */
export function TimestampPickerModal({
  visible,
  value,
  locale,
  onSave,
  onCancel,
}: {
  visible: boolean;
  /** The photo's current timestamp (ms epoch or ISO), or null when it has none. */
  value: number | string | null;
  locale: string;
  onSave: (date: Date) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  if (Platform.OS === "android") {
    return <AndroidTimestampDialogs visible={visible} value={value} onSave={onSave} onCancel={onCancel} />;
  }
  return (
    <ModalSheet visible={visible} title={t("viewer.editDateTime")} onClose={onCancel} testID="viewer-timestamp-picker">
      <PickerBody value={value} locale={locale} onSave={onSave} onCancel={onCancel} />
    </ModalSheet>
  );
}

/** Android: the date dialog, then the time dialog. Renders nothing itself. */
function AndroidTimestampDialogs({
  visible,
  value,
  onSave,
  onCancel,
}: {
  visible: boolean;
  value: number | string | null;
  onSave: (date: Date) => void;
  onCancel: () => void;
}) {
  // The latest callbacks, so a parent re-render cannot reopen the dialogs.
  const latest = useRef({ value, onSave, onCancel });
  useEffect(() => {
    latest.current = { value, onSave, onCancel };
  });

  useEffect(() => {
    if (!visible) return;
    let open = true;
    const cancel = () => {
      if (open) latest.current.onCancel();
    };
    DateTimePickerAndroid.open({
      value: pickerInitialDate(latest.current.value),
      mode: "date",
      onDismiss: cancel,
      onValueChange: (_event, day) => {
        if (!open) return;
        DateTimePickerAndroid.open({
          value: day,
          mode: "time",
          is24Hour: true,
          onDismiss: cancel,
          onValueChange: (_timeEvent, moment) => {
            if (open) latest.current.onSave(moment);
          },
        });
      },
    });
    return () => {
      open = false;
    };
  }, [visible]);

  return null;
}

/**
 * The sheet's content (iOS). A modal mounts its content on each opening, so every
 * opening starts from the photo's own value, not from an abandoned edit.
 */
function PickerBody({
  value,
  locale,
  onSave,
  onCancel,
}: {
  value: number | string | null;
  locale: string;
  onSave: (date: Date) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const [date, setDate] = useState(() => pickerInitialDate(value));

  const onValueChange = (_event: DateTimePickerChangeEvent, picked: Date) => setDate(picked);

  return (
    <>
      <Text testID="viewer-timestamp-picker-value" style={{ color: theme.text, fontSize: 15, fontWeight: "600" }}>
        {formatFullDate(date.getTime(), { locale })}
      </Text>

      <DateTimePicker
        testID="viewer-timestamp-picker-wheel"
        value={date}
        mode="datetime"
        display="spinner"
        locale={locale}
        themeVariant={scheme}
        onValueChange={onValueChange}
      />

      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 20, paddingTop: 8 }}>
        <Pressable testID="viewer-timestamp-picker-cancel" onPress={onCancel} hitSlop={12} accessibilityRole="button">
          <Text style={{ color: theme.muted, fontWeight: "600", fontSize: 15 }}>{t("common.cancel")}</Text>
        </Pressable>
        <Pressable
          testID="viewer-timestamp-picker-save"
          onPress={() => onSave(date)}
          hitSlop={12}
          accessibilityRole="button"
        >
          <Text style={{ color: theme.brand, fontWeight: "700", fontSize: 15 }}>{t("common.save")}</Text>
        </Pressable>
      </View>
    </>
  );
}
