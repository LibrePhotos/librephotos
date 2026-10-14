import type { SearchFilters } from "@librephotos/api-client";
import { Divider, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks/useFetchPeopleAlbumsQuery";
import { FileFilter, LocationFilter } from "./FileFilter";
import { MetadataValueSelect } from "./MetadataValueSelect";
import { PeopleFilter } from "./PeopleFilter";
import { RangeFilter } from "./RangeFilter";
import { RatingFilter } from "./RatingFilter";
import { RANGE_FIELDS } from "./searchFilterRanges";
import { TakenFilter } from "./TakenFilter";

type Props = Readonly<{
  filters: SearchFilters;
  onChange: (patch: SearchFilters) => void;
  people: readonly Person[];
  /** See RatingFilter. */
  favoriteRating: number | undefined;
  /** The panel is on screen: load the camera suggestions. */
  active: boolean;
}>;

function Section({ id, label, children }: Readonly<{ id: string; label: string; children: React.ReactNode }>) {
  return (
    <Stack gap="xs" role="group" aria-labelledby={id}>
      <Text id={id} size="xs" fw={700} c="dimmed" tt="uppercase">
        {label}
      </Text>
      {children}
    </Stack>
  );
}

// Every search filter in one panel: People, Camera, Exposure, Rating, Taken, Location, File.
// Changes apply at once (number and extension fields on blur or Enter).
export function SearchFilterPanel({ filters, onChange, people, favoriteRating, active }: Props) {
  const { t } = useTranslation();
  return (
    <Stack gap="md">
      <Section id="search-filter-people" label={t("searchfilter.section.people")}>
        <PeopleFilter
          people={people}
          value={filters.person}
          onChange={person => onChange({ person })}
          labelId="search-filter-people"
        />
      </Section>
      <Divider />
      <Section id="search-filter-camera" label={t("searchfilter.section.camera")}>
        <MetadataValueSelect field="make" value={filters.make} onChange={make => onChange({ make })} active={active} />
        <MetadataValueSelect
          field="camera"
          value={filters.camera}
          onChange={camera => onChange({ camera })}
          active={active}
        />
        <MetadataValueSelect field="lens" value={filters.lens} onChange={lens => onChange({ lens })} active={active} />
        <Text size="xs" c="dimmed">
          {t("searchfilter.countshint")}
        </Text>
      </Section>
      <Divider />
      <Section id="search-filter-exposure" label={t("searchfilter.section.exposure")}>
        {RANGE_FIELDS.map(field => {
          const low = filters[field.min];
          const high = filters[field.max];
          return (
            <RangeFilter
              // A new range from the URL (a chip removed, Back) starts the fields over.
              key={`${field.id}:${low}:${high}`}
              field={field}
              low={low}
              high={high}
              onChange={(nextLow, nextHigh) => {
                const patch: SearchFilters = {};
                patch[field.min] = nextLow;
                patch[field.max] = nextHigh;
                onChange(patch);
              }}
            />
          );
        })}
      </Section>
      <Divider />
      <Section id="search-filter-rating" label={t("searchfilter.section.rating")}>
        <RatingFilter
          value={filters.rating_min}
          onChange={rating => onChange({ rating_min: rating })}
          favoriteRating={favoriteRating}
          labelId="search-filter-rating"
        />
      </Section>
      <Divider />
      <Section id="search-filter-taken" label={t("searchfilter.section.taken")}>
        <TakenFilter
          after={filters.taken_after}
          before={filters.taken_before}
          onChange={(after, before) => onChange({ taken_after: after, taken_before: before })}
          labelId="search-filter-taken"
        />
      </Section>
      <Divider />
      <Section id="search-filter-location" label={t("searchfilter.section.location")}>
        <LocationFilter
          value={filters.has_location}
          onChange={hasLocation => onChange({ has_location: hasLocation })}
          labelId="search-filter-location"
        />
      </Section>
      <Divider />
      <Section id="search-filter-file" label={t("searchfilter.section.file")}>
        <FileFilter key={filters.extension ?? ""} filters={filters} onChange={onChange} />
      </Section>
    </Stack>
  );
}
