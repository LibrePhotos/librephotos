import { Avatar, SimpleGrid, Text, UnstyledButton } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import { serverAddress } from "../../api_client/urls";
import classes from "./RecentlyTaggedGrid.module.css";

type Props = Readonly<{
  people: readonly Person[];
  onSelect: (person: Person) => void;
  /** The id of the heading that names the group. */
  labelledBy: string;
}>;

/**
 * The people tagged last, as a grid of faces to pick from in one click (#865). The list holds at
 * most RECENTLY_TAGGED_PEOPLE_LIMIT (10) people: two rows of five, three of four on a phone.
 */
export function RecentlyTaggedGrid({ people, onSelect, labelledBy }: Props) {
  const { t } = useTranslation();

  return (
    <div role="group" aria-labelledby={labelledBy}>
      <SimpleGrid cols={{ base: 4, xs: 5 }} spacing="xs" verticalSpacing="xs">
        {people.map(person => (
          // The title shows a name the two lines cut off
          <UnstyledButton
            key={person.id}
            className={classes.person}
            title={person.name}
            onClick={() => onSelect(person)}
          >
            <Avatar radius="xl" size={48} src={serverAddress + person.face_url} alt="" />
            <Text component="span" size="xs" fw={500} ta="center" lineClamp={2} className={classes.name}>
              {person.name}
            </Text>
            <Text component="span" size="xs" c="dimmed">
              {/* number keeps the plain key working in locales without plurals */}
              {t("facesdashboard.numberoffaces", { count: person.face_count, number: person.face_count })}
            </Text>
          </UnstyledButton>
        ))}
      </SimpleGrid>
    </div>
  );
}
