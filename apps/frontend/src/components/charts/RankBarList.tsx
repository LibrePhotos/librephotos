import type { SearchFilters } from "@librephotos/api-client";
import { Anchor, Box, Stack } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { TabCount } from "../common/TabCount";
import classes from "./StatisticsCharts.module.css";

export type RankRow = Readonly<{
  key: string;
  label: string;
  count: number;
  search: SearchFilters;
}>;

type Props = Readonly<{
  rows: readonly RankRow[];
  limit: number;
}>;

export function RankBarList({ rows, limit }: Props) {
  const { t } = useTranslation();
  const [expanded, { toggle }] = useDisclosure(false);
  const listId = useId();
  const most = Math.max(0, ...rows.map(row => row.count));
  const shown = expanded ? rows : rows.slice(0, limit);
  return (
    <Stack gap={0}>
      <ul id={listId} className={classes.rankList}>
        {shown.map(row => (
          <li key={row.key}>
            <Link to="/search" search={row.search} className={classes.rankLink}>
              <span className={classes.rankName} title={row.label}>
                {row.label}
              </span>
              <span className={classes.rankTrack} aria-hidden>
                <Box component="span" className={classes.rankFill} w={`${(row.count / most) * 100}%`} />
              </span>
              <span className={classes.rankCount}>{t("statistics.photocount", { count: row.count })}</span>
            </Link>
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <Anchor
          component="button"
          type="button"
          size="sm"
          className={classes.rankMore}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={toggle}
        >
          {expanded ? (
            <>
              {t("statistics.showfewer")}
              <IconChevronUp size={14} aria-hidden />
            </>
          ) : (
            <>
              {t("statistics.showall")}
              <TabCount count={rows.length} />
              <IconChevronDown size={14} aria-hidden />
            </>
          )}
        </Anchor>
      )}
    </Stack>
  );
}
