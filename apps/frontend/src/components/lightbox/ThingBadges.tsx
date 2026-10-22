import { Badge, Group, Stack, Text, Title } from "@mantine/core";
import { IconTags as Tags } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useThingLabel } from "../../hooks/useThingLabel";
import classes from "./ThingBadges.module.css";

type Props = Readonly<{
  /** The tagging model's words for the photo, as stored (English). */
  things: readonly string[];
  imageHash: string;
  isPublic: boolean;
  /** The photo page's cards bring their own heading: the section is a label under it. */
  inCard: boolean;
}>;

/**
 * The tagging model's own output (Things, as in the album list), not the
 * user's tags: both used to render as "Tags" here. Each thing shows in the
 * interface language and searches for the stored English word, which its
 * tooltip names when the two differ (search only knows the English words).
 */
export function ThingBadges({ things, imageHash, isPublic, inCard }: Props) {
  const { t } = useTranslation();
  const thingLabel = useThingLabel();
  const navigate = useNavigate();

  return (
    <Stack gap="xs">
      {inCard ? (
        <Text size="xs" c="dimmed" fw={500}>
          {t("things")}
        </Text>
      ) : (
        <Group>
          <Tags />
          <Title order={4}>{t("things")}</Title>
        </Group>
      )}
      <Group gap="xs">
        {things.map(thing => {
          const label = thingLabel(thing);
          const badgeProps = {
            color: "green",
            variant: "light",
            title: label === thing ? undefined : thing,
          } as const;
          // Search needs a login, so a public page's things are just labels;
          // the owner's are buttons, so the keyboard can reach them too.
          return isPublic ? (
            <Badge key={`lightbox_autotag_${imageHash}_${thing}`} {...badgeProps}>
              {label}
            </Badge>
          ) : (
            <Badge
              key={`lightbox_autotag_${imageHash}_${thing}`}
              {...badgeProps}
              component="button"
              type="button"
              className={`mantine-focus-auto ${classes.searchable}`}
              onClick={() => void navigate({ to: `/search/${encodeURIComponent(thing)}` })}
            >
              {label}
            </Badge>
          );
        })}
      </Group>
    </Stack>
  );
}
