import { UnstyledButton } from "@mantine/core";
import { IconCake } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { calendarDaysAgo, formatCalendarDay, parseCalendarDay } from "../../util/dateUtils";
import { ageAt, ageToday } from "./personAge";
import classes from "./PersonBirthDateLine.module.css";

type Props = Readonly<{
  name: string;
  /** `YYYY-MM-DD`. */
  birthDate: string;
  /** Opens the birth date dialog; focus comes back to `from` when it closes. */
  onEdit: (from: HTMLElement) => void;
}>;

/** "Born 3 May 2019 · 6 years old" under a person's name (#2751); a click edits the date. */
export function PersonBirthDateLine({ name, birthDate, onEdit }: Props) {
  const { t } = useTranslation();
  const age = ageAt(birthDate, parseCalendarDay(calendarDaysAgo(0)));
  const born = t("personbirthdate.born", { date: formatCalendarDay(birthDate) });
  return (
    <UnstyledButton
      className={classes.line}
      title={t("personbirthdate.edit", { name })}
      onClick={event => onEdit(event.currentTarget)}
    >
      <IconCake size={ICON_SIZE.inline} aria-hidden />
      {age ? `${born} · ${ageToday(t, age)}` : born}
    </UnstyledButton>
  );
}
