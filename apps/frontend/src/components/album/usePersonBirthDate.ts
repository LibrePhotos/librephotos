import { useDisclosure } from "@mantine/hooks";
import { useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { GroupNote } from "../../util/util";
import { ageAt, ageNote } from "./personAge";

/**
 * The person page's birth date (#2750, #2751): the dialog's state, opened from the ⋮ menu or the
 * header line, and the age beside each day heading (none without a birth date).
 */
export function usePersonBirthDate(birthDate: string | null) {
  const { t } = useTranslation();
  const [opened, { open, close }] = useDisclosure(false);
  // The control the dialog was opened from: a menu item is gone when it closes
  const opener = useRef<HTMLElement | null>(null);
  const openFrom = useCallback(
    (from: HTMLElement | null) => {
      opener.current = from;
      open();
    },
    [open]
  );
  const closeAndFocus = useCallback(() => {
    close();
    opener.current?.focus();
  }, [close]);
  const groupNote = useMemo<GroupNote | undefined>(() => {
    if (birthDate === null) return undefined;
    return day => {
      const age = ageAt(birthDate, day);
      return age ? ageNote(t, age) : null;
    };
  }, [birthDate, t]);
  return { opened, openFrom, close: closeAndFocus, groupNote };
}
