import { Photoset } from "@librephotos/api-client";
import { Group, HoverCard, SimpleGrid, Stack, Text } from "@mantine/core";
import {
  IconFaceId as FaceId,
  IconMapPin as MapPin,
  IconPhoto as Photo,
  IconQuestionMark as QuestionMark,
  IconSettingsAutomation as SettingsAutomation,
  IconTag as Tag,
  IconUsers as Users,
} from "@tabler/icons-react";
import { Trans, useTranslation } from "react-i18next";
import { useFetchDateAlbumsQuery } from "../api_client/albums/hooks";
import { useFetchCountStatsQuery } from "../api_client/stats/hooks";
import { COUNT_STATS_DEFAULTS } from "../api_client/stats/types";
import { i18nResolvedLanguage } from "../i18n";
import { formatCount } from "../util/formatCount";
import { StatCount, StatTile, statTileFillClass } from "./StatTile";

const TILE_ICON = { size: 18, stroke: 1.75 } as const;

/**
 * The photos the timeline shows: the server's count of visible photos (not hidden, not in the
 * trash) still holds the archived ones, which the timeline leaves out, so "199" here read against
 * "198 photos" there. The archived photos are the Archived page's own list, cached with it.
 */
function useTimelinePhotoCount(visiblePhotos: number) {
  const { data: archivedDays } = useFetchDateAlbumsQuery({ photosetType: Photoset.ARCHIVED });
  const archived = archivedDays?.reduce((sum, day) => sum + day.numberOfItems, 0) ?? 0;
  return Math.max(0, visiblePhotos - archived);
}

/**
 * The library at a glance, the same tiles on the Library page and above the Statistics charts:
 * photos and days, people and faces (with the face breakdown on hover), events and places. A server
 * too old to count places leaves that tile out.
 */
export function CountStats() {
  const { t } = useTranslation();
  const locale = i18nResolvedLanguage();
  const { data: countStats = COUNT_STATS_DEFAULTS } = useFetchCountStatsQuery();
  const photos = useTimelinePhotoCount(countStats.num_photos);
  const places = countStats.num_places;

  return (
    <SimpleGrid cols={{ base: 2, sm: places === undefined ? 3 : 4 }} spacing="xs">
      <StatTile
        icon={<Photo {...TILE_ICON} />}
        label={t("countstats.photos")}
        value={<StatCount value={photos} />}
        detail={
          <>
            / <StatCount value={countStats.num_albumdate} /> {t("countstats.days")}
          </>
        }
      />

      {/* No count tooltips here: the tile is already a HoverCard target. */}
      <HoverCard width={200} shadow="md" withinPortal withArrow>
        <HoverCard.Target>
          <div className={statTileFillClass}>
            <StatTile
              icon={<Users {...TILE_ICON} />}
              label={t("people")}
              value={<StatCount value={countStats.num_people} withTooltip={false} />}
              detail={
                <>
                  / <StatCount value={countStats.num_faces} withTooltip={false} /> {t("countstats.faces")}
                </>
              }
            />
          </div>
        </HoverCard.Target>
        <HoverCard.Dropdown>
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm">
                <Trans i18nKey="settings.inferred" />
              </Text>
              <Group gap="xs">
                <FaceId size={16} />
                <Text size="sm">{formatCount(countStats.num_inferred_faces, locale)}</Text>
              </Group>
            </Group>
            <Group justify="space-between">
              <Text size="sm">
                <Trans i18nKey="settings.labeled" />
              </Text>
              <Group gap="xs">
                <Tag size={16} />
                <Text size="sm">{formatCount(countStats.num_labeled_faces, locale)}</Text>
              </Group>
            </Group>
            <Group justify="space-between">
              <Text size="sm">
                <Trans i18nKey="settings.unknown" />
              </Text>
              <Group gap="xs">
                <QuestionMark size={16} />
                <Text size="sm">{formatCount(countStats.num_unknown_faces, locale)}</Text>
              </Group>
            </Group>
          </Stack>
        </HoverCard.Dropdown>
      </HoverCard>

      <StatTile
        icon={<SettingsAutomation {...TILE_ICON} />}
        label={t("events")}
        value={<StatCount value={countStats.num_albumauto} />}
      />
      {places === undefined ? null : (
        <StatTile icon={<MapPin {...TILE_ICON} />} label={t("places")} value={<StatCount value={places} />} />
      )}
    </SimpleGrid>
  );
}
