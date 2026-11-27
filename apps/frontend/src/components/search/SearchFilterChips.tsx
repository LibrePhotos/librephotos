import type { Photo, SearchFilters } from "@librephotos/api-client";
import { Avatar, Badge, Button, CloseButton, Group } from "@mantine/core";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPeopleAlbumsQuery } from "../../api_client/albums/hooks";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks";
import { i18nResolvedLanguage } from "../../i18n";
import { MediaThumbnail } from "../common/MediaThumbnail";
import { faceSource } from "./PeopleFilter";
import { describeSearchFilters, type SearchFilterChip } from "./searchFilterLabels";

type Props = Readonly<{
  filters: SearchFilters;
  onChange: (patch: SearchFilters) => void;
  onClear: () => void;
  /** See RatingFilter. */
  favoriteRating: number | undefined;
}>;

type ChipPictures = Readonly<{
  face: (personId: number) => string | undefined;
  similar: Pick<Photo, "image_hash" | "video"> | null | undefined;
}>;

function chipPicture(chip: SearchFilterChip, { face, similar }: ChipPictures) {
  if (chip.personId !== undefined) return <Avatar src={face(chip.personId)} alt="" radius="xl" size={18} />;
  if (chip.similarTo === undefined || !similar) return undefined;
  return <MediaThumbnail imageHash={similar.image_hash} video={similar.video} size={18} radius="sm" />;
}

// The active search filters as removable sentence chips under the title, plus Clear all (which
// keeps the words and the media type). People chips carry the face.
export function SearchFilterChips({ filters, onChange, onClear, favoriteRating }: Props) {
  const { t } = useTranslation();
  const { data: people } = useFetchPeopleAlbumsQuery(!filters.person);
  const byId = useMemo(() => new Map((people ?? []).map(person => [Number(person.id), person])), [people]);
  const { data: similarPhoto } = useFetchPhotoDetailsQuery(filters.similar_to ?? "", !filters.similar_to);
  const pictures = { face: (id: number) => faceSource(byId.get(id)), similar: similarPhoto };
  const chips = describeSearchFilters(filters, {
    t,
    language: i18nResolvedLanguage(),
    personName: id => byId.get(id)?.name,
    favoriteRating,
  });
  if (chips.length === 0) return null;

  return (
    <Group gap={6} pt={6} aria-label={t("searchfilter.title")} role="group">
      {chips.map(chip => (
        <Badge
          key={chip.id}
          variant="light"
          size="lg"
          tt="none"
          fw={500}
          pr={2}
          leftSection={chipPicture(chip, pictures)}
          rightSection={
            <CloseButton
              size="xs"
              radius="xl"
              variant="transparent"
              aria-label={t("searchfilter.chip.remove", { label: chip.label })}
              onClick={() => onChange(chip.patch)}
            />
          }
        >
          {chip.label}
        </Badge>
      ))}
      <Button variant="subtle" size="compact-xs" onClick={onClear}>
        {t("searchfilter.clearall")}
      </Button>
    </Group>
  );
}
