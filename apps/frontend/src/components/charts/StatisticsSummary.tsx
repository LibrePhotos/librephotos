import { SimpleGrid } from "@mantine/core";
import { IconMapPin, IconPhoto, IconSettingsAutomation, IconUsers } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useFetchCountStatsQuery } from "../../api_client/stats/hooks";
import { COUNT_STATS_DEFAULTS } from "../../api_client/stats/types";
import { StatCount, StatTile } from "../StatTile";

const TILE_ICON = { size: 16, stroke: 1.75 } as const;

/**
 * The library at a glance above the Statistics charts: photos, events, people and places, from the
 * same counts the Library page shows. A server too old to count places leaves that tile out.
 */
export function StatisticsSummary() {
  const { t } = useTranslation();
  const { data: countStats = COUNT_STATS_DEFAULTS } = useFetchCountStatsQuery();
  const places = countStats.num_places;

  return (
    <SimpleGrid cols={{ base: 2, sm: places === undefined ? 3 : 4 }} spacing="xs">
      <StatTile
        icon={<IconPhoto {...TILE_ICON} />}
        label={t("countstats.photos")}
        value={<StatCount value={countStats.num_photos} />}
      />
      <StatTile
        icon={<IconSettingsAutomation {...TILE_ICON} />}
        label={t("events")}
        value={<StatCount value={countStats.num_albumauto} />}
      />
      <StatTile
        icon={<IconUsers {...TILE_ICON} />}
        label={t("people")}
        value={<StatCount value={countStats.num_people} />}
      />
      {places === undefined ? null : (
        <StatTile icon={<IconMapPin {...TILE_ICON} />} label={t("places")} value={<StatCount value={places} />} />
      )}
    </SimpleGrid>
  );
}
