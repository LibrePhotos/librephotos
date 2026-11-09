import { UnstyledButton } from "@mantine/core";
import { IconCake } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { formatPhotoDaySpan } from "../../util/dateUtils";
import { CollectionMeta } from "./CollectionMeta";
import { PersonBirthDateLine } from "./PersonBirthDateLine";
import classes from "./PersonBirthDateLine.module.css";

type Props = Readonly<{
  person: Pick<Person, "name" | "birth_date">;
  /** The person's day groups, loaded or not: their dates give the span. */
  groups: ReadonlyArray<{ date: string | null }>;
  /** Opens the birth date dialog; focus comes back to `from` when it closes. */
  onBirthDate: (from: HTMLElement) => void;
}>;

/**
 * Under a person's name: the days their photos span ("Aug 16, 2012"), then their birth date and
 * age (#2751), or a quiet "Add birth date" that opens the same dialog as the ⋮ menu.
 */
export function PersonMeta({ person, groups, onBirthDate }: Props) {
  const { t } = useTranslation();
  const daySpan = formatPhotoDaySpan(groups.map(group => group.date));
  const birthDate = person.birth_date ? (
    <PersonBirthDateLine name={person.name} birthDate={person.birth_date} onEdit={onBirthDate} />
  ) : (
    <UnstyledButton className={classes.line} onClick={event => onBirthDate(event.currentTarget)}>
      <IconCake size={ICON_SIZE.inline} aria-hidden />
      {t("personbirthdate.add")}
    </UnstyledButton>
  );
  return <CollectionMeta parts={[daySpan]} trailing={birthDate} />;
}
