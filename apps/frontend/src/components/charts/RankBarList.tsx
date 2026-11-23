import type { SearchFilters } from "@librephotos/api-client";
import { Box } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import classes from "./StatisticsCharts.module.css";

export type RankRow = Readonly<{
  key: string;
  label: string;
  count: number;
  search: SearchFilters;
}>;

type Props = Readonly<{
  rows: readonly RankRow[];
}>;

export function RankBarList({ rows }: Props) {
  const { t } = useTranslation();
  const most = Math.max(0, ...rows.map(row => row.count));
  return (
    <ul className={classes.rankList}>
      {rows.map(row => (
        <li key={row.key}>
          <Link to="/search" search={row.search} className={classes.rankLink}>
            <span className={classes.rankName}>{row.label}</span>
            <span className={classes.rankTrack} aria-hidden>
              <Box component="span" className={classes.rankFill} w={`${(row.count / most) * 100}%`} />
            </span>
            <span className={classes.rankCount}>{t("statistics.photocount", { count: row.count })}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
