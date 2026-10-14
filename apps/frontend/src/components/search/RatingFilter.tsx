import { Button, Group, Rating, Switch, Text } from "@mantine/core";
import { IconStar } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { FAVORITE_COLOR, ICON_SIZE } from "../../uiConstants";

type Props = Readonly<{
  value: number | undefined;
  onChange: (rating: number | undefined) => void;
  /**
   * The user's favorite threshold when they rate with the favorite toggle (#2601): the section is
   * then one "Favorites only" switch. Undefined in stars mode, which offers 1 to 5 stars.
   */
  favoriteRating: number | undefined;
  labelId: string;
}>;

// The rating section of the search filters, in the user's rating mode.
export function RatingFilter({ value, onChange, favoriteRating, labelId }: Props) {
  const { t } = useTranslation();
  if (favoriteRating !== undefined) {
    return (
      <Switch
        checked={value !== undefined}
        onChange={event => onChange(event.currentTarget.checked ? favoriteRating : undefined)}
        label={
          <Group gap={6} wrap="nowrap">
            <IconStar size={ICON_SIZE.inline} color={FAVORITE_COLOR} />
            {t("searchfilter.rating.favorites")}
          </Group>
        }
      />
    );
  }
  return (
    <Group gap="sm" wrap="nowrap">
      <Rating
        value={value ?? 0}
        onChange={rating => onChange(rating > 0 ? rating : undefined)}
        aria-labelledby={labelId}
        getSymbolLabel={stars => t("searchfilter.chip.rating", { count: stars })}
      />
      <Text size="sm" c="dimmed" flex={1}>
        {value ? t("searchfilter.chip.rating", { count: value }) : t("searchfilter.rating.any")}
      </Text>
      {value !== undefined && (
        <Button variant="subtle" size="compact-xs" onClick={() => onChange(undefined)}>
          {t("searchfilter.rating.any")}
        </Button>
      )}
    </Group>
  );
}
