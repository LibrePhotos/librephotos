import { Avatar, Group, MultiSelect, Text } from "@mantine/core";
import type { OptionsFilter } from "@mantine/core";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import { serverAddress } from "../../api_client/urls";

const MAX_PEOPLE = 20;

type Props = Readonly<{
  people: readonly Person[];
  value: readonly number[] | undefined;
  onChange: (people: number[] | undefined) => void;
  /** The people section's label, which names the picker. */
  labelId: string;
}>;

export function faceSource(person: Pick<Person, "face_url"> | undefined): string | undefined {
  return person?.face_url ? `${serverAddress}${person.face_url}` : undefined;
}

// The people of the filter panel (#329): photos showing every picked person.
export function PeopleFilter({ people, value, onChange, labelId }: Props) {
  const { t } = useTranslation();
  const byId = useMemo(() => new Map(people.map(person => [person.id, person])), [people]);
  const data = useMemo(() => people.map(person => ({ value: person.id, label: person.name })), [people]);

  // Typing a name lists the people with the most faces first, as the face dialog does (#301);
  // without a search the list stays in name order. The sort is stable, so equal counts keep it.
  // The match is Mantine's own: the label contains the search, case aside.
  const matchesByFaceCount: OptionsFilter = ({ options, search }) => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    const faceCount = (value: string) => byId.get(value)?.face_count ?? 0;
    return options
      .filter(option => "value" in option && option.label.toLowerCase().includes(query))
      .sort((a, b) => ("value" in a && "value" in b ? faceCount(b.value) - faceCount(a.value) : 0));
  };

  return (
    <MultiSelect
      aria-labelledby={labelId}
      description={t("searchfilter.people.hint")}
      inputWrapperOrder={["label", "input", "description"]}
      placeholder={value?.length ? undefined : t("searchfilter.people.placeholder")}
      data={data}
      value={(value ?? []).map(String)}
      onChange={ids => {
        const numbers = ids.map(Number).filter(Number.isInteger);
        onChange(numbers.length > 0 ? numbers : undefined);
      }}
      searchable
      filter={matchesByFaceCount}
      clearable
      hidePickedOptions
      // The panel focuses this first field when it opens: a list over the next sections would be in the way.
      openOnFocus={false}
      maxValues={MAX_PEOPLE}
      nothingFoundMessage={t("searchfilter.people.nothingfound")}
      comboboxProps={{ withinPortal: false }}
      renderOption={({ option }) => {
        const person = byId.get(option.value);
        return (
          <Group gap="xs" wrap="nowrap" w="100%">
            <Avatar src={faceSource(person)} alt="" radius="xl" size={24} />
            <Text size="sm" flex={1} truncate>
              {option.label}
            </Text>
            {person && (
              <Text size="xs" c="dimmed">
                {t("searchfilter.people.facecount", { count: person.face_count })}
              </Text>
            )}
          </Group>
        );
      }}
    />
  );
}
