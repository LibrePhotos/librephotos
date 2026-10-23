import type { GalleryPhotographer } from "@librephotos/api-client";
import { Avatar, Chip, CloseButton, Group, ScrollArea, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { sharerName } from "../sharing/sharerGroups";
import classes from "./GalleryFilters.module.css";

// Chips beyond this many photographers would not fit a row anyway: the Photographers tab lists all.
const CHIPS_SHOWN = 30;
const EVERYONE = "everyone";

type OwnerChipsProps = Readonly<{
  photographers: GalleryPhotographer[];
  owner: number | undefined;
  onChange: (owner: number | undefined) => void;
}>;

/** Everyone, or one photographer: filters the timeline, places and people in place. */
export function OwnerChips({ photographers, owner, onChange }: OwnerChipsProps) {
  const { t } = useTranslation();
  return (
    <ScrollArea type="never" className={classes.chips}>
      <Chip.Group
        value={owner === undefined ? EVERYONE : String(owner)}
        onChange={value => onChange(value === EVERYONE ? undefined : Number(value))}
      >
        <Group gap="xs" wrap="nowrap" py="xs">
          <Chip value={EVERYONE} size="sm">
            {t("gallery.everyone")}
          </Chip>
          {photographers.slice(0, CHIPS_SHOWN).map(photographer => {
            const name = sharerName(photographer, photographer.username);
            return (
              <Chip key={photographer.id} value={String(photographer.id)} size="sm">
                <Group gap={6} wrap="nowrap" component="span">
                  <Avatar component="span" size={18} radius="xl" name={name} color="initials" alt="" />
                  <span>{name}</span>
                  <Text component="span" size="xs" c="dimmed">
                    {photographer.photo_count}
                  </Text>
                </Group>
              </Chip>
            );
          })}
        </Group>
      </Chip.Group>
    </ScrollArea>
  );
}

type ActiveFilterProps = Readonly<{ label: string; onRemove: () => void }>;

/** A town or a person the timeline is narrowed to, with the button that takes it off. */
export function ActiveFilter({ label, onRemove }: ActiveFilterProps) {
  const { t } = useTranslation();
  return (
    <Group gap={4} wrap="nowrap" className={classes.activeFilter}>
      <Text size="sm">{label}</Text>
      <CloseButton size="sm" aria-label={t("gallery.removeFilter", { name: label })} onClick={onRemove} />
    </Group>
  );
}
