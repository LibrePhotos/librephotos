import type { AlbumCollection } from "@librephotos/api-client";
import { ActionIcon, Button, Chip, Group, Menu, Text } from "@mantine/core";
import { IconDotsVertical, IconPlus, IconSettings } from "@tabler/icons-react";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import classes from "./AlbumCollectionFilter.module.css";
import { NOT_IN_A_COLLECTION, type CollectionFilter } from "./collectionFilter";

const ALL = "all";

type Props = Readonly<{
  collections: readonly AlbumCollection[];
  /** Albums per collection, those in none, and all of them. */
  counts: { byCollection: ReadonlyMap<number, number>; none: number; all: number };
  value: CollectionFilter;
  onChange: (filter: CollectionFilter) => void;
  onManage: () => void;
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
 * in a collection"; picking one filters the grid. Without collections it offers to make one.
 */
export function AlbumCollectionFilter({ collections, counts, value, onChange, onManage }: Props) {
  const { t } = useTranslation();

  if (collections.length === 0) {
    return (
      <Group gap="xs" wrap="nowrap" className={classes.row}>
        <Button
          variant="default"
          radius="xl"
          size="compact-sm"
          className={classes.newCollection}
          leftSection={<IconPlus size={ICON_SIZE.menu} />}
          onClick={onManage}
        >
          {t("albumcollections.new")}
        </Button>
        <Text size="xs" c="dimmed" visibleFrom="sm">
          {t("albumcollections.hint")}
        </Text>
      </Group>
    );
  }

  return (
    <Group gap="xs" wrap="nowrap" className={classes.row}>
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
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label={t("albumcollections.actions")}>
            <IconDotsVertical size={ICON_SIZE.inline} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconSettings size={ICON_SIZE.menu} />} onClick={onManage}>
            {t("albumcollections.manage")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}
