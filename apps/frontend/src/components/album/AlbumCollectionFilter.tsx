import type { AlbumCollection } from "@librephotos/api-client";
import { Chip, Group, Text } from "@mantine/core";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import classes from "./AlbumCollectionFilter.module.css";
import { NOT_IN_A_COLLECTION, type CollectionFilter } from "./collectionFilter";

const ALL = "all";

type Props = Readonly<{
  collections: readonly AlbumCollection[];
  /** Albums per collection, those in none, and all of them. */
  counts: { byCollection: ReadonlyMap<number, number>; none: number; all: number };
  value: CollectionFilter;
  onChange: (filter: CollectionFilter) => void;
}>;

function chipValue(filter: CollectionFilter): string {
  return filter === undefined ? ALL : String(filter);
}

function filterOf(value: string): CollectionFilter {
  if (value === ALL) return undefined;
  if (value === NOT_IN_A_COLLECTION) return NOT_IN_A_COLLECTION;
  return Number(value);
}

function Label({ name, count }: Readonly<{ name: ReactNode; count: number }>) {
  return (
    <>
      {name}
      {/* Fainter than the name, also on a checked (filled) chip */}
      <Text span size="xs" className={classes.count}>
        {count}
      </Text>
    </>
  );
}

/**
 * My Albums' collection row (#1009): All, one chip per collection with its album count, and "Not
 * in a collection"; picking one filters the grid. Nothing without collections: the header's ⋯
 * makes the first one (MyAlbumsHeaderMenu), and manages them once there are some.
 */
export function AlbumCollectionFilter({ collections, counts, value, onChange }: Props) {
  const { t } = useTranslation();

  if (collections.length === 0) return null;

  return (
    <div className={classes.row}>
      <Chip.Group multiple={false} value={chipValue(value)} onChange={next => onChange(filterOf(next))}>
        <Group gap="xs" className={classes.chips} role="radiogroup" aria-label={t("albumcollections.title")}>
          <Chip value={ALL} size="sm">
            <Label name={t("albumcollections.all")} count={counts.all} />
          </Chip>
          {collections.map(collection => (
            <Chip key={collection.id} value={String(collection.id)} size="sm">
              <Label name={collection.name} count={counts.byCollection.get(collection.id) ?? 0} />
            </Chip>
          ))}
          <Chip value={NOT_IN_A_COLLECTION} size="sm">
            <Label name={t("albumcollections.notinany")} count={counts.none} />
          </Chip>
        </Group>
      </Chip.Group>
    </div>
  );
}
