import type { PersonGroup } from "@librephotos/api-client";
import { ActionIcon, Group, Indicator, Menu, Tooltip, useMantineTheme } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconDots } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_ACTION_SIZE } from "../../uiConstants";
import { toolbarLook } from "../common/toolbarLook";
import { PageHeader } from "../PageHeader";
import { sameSort } from "./albumSort";
import { AlbumSortMenu, AlbumSortMenuItems } from "./AlbumSortMenu";
import { FacesReviewLink } from "./FacesReviewLink";
import { ManagePersonGroupsModal } from "./ManagePersonGroupsModal";
import classes from "./PeopleHeader.module.css";
import { PersonGroupFilter, PersonGroupMenuItems } from "./PersonGroupFilter";
import type { AlbumSortMenuState } from "./useAlbumSort";

type Props = Readonly<{
  loading: boolean;
  /** How many people the user has, and how many the page shows. */
  total: number;
  shown: number;
  groups: readonly PersonGroup[];
  /** The group the page is narrowed to (#1126), if any. */
  group: PersonGroup | undefined;
  onGroupChange: (group: number | undefined) => void;
  /** The sort menu's state (#620); it shows while there are people to sort. */
  sort: AlbumSortMenuState;
}>;

type ControlsProps = Omit<Props, "loading" | "shown">;

/** A phone's header holds one ⋮ beside the title: the sort and the group filter in one menu. */
function PeopleOverflowMenu({ groups, group, onGroupChange, sort }: ControlsProps) {
  const { t } = useTranslation();
  const [manageOpened, manage] = useDisclosure(false);
  // A dot on the ⋮ while the list is not in its default order or narrowed to a group
  const changed = group !== undefined || !sameSort(sort.sort, sort.defaultSort);
  return (
    <>
      <Menu position="bottom-end" shadow="md">
        <Indicator size={8} offset={4} disabled={!changed}>
          <Menu.Target>
            <Tooltip label={t("personalbum.peopleoptions")} position="bottom">
              <ActionIcon {...toolbarLook()} size={TOOLBAR_ACTION_SIZE} aria-label={t("personalbum.peopleoptions")}>
                <IconDots size={ICON_SIZE.toolbar} />
              </ActionIcon>
            </Tooltip>
          </Menu.Target>
        </Indicator>
        <Menu.Dropdown>
          <AlbumSortMenuItems {...sort} />
          <Menu.Divider />
          <Menu.Label>{t("persongroups.title")}</Menu.Label>
          <PersonGroupMenuItems groups={groups} value={group?.id} onChange={onGroupChange} onManage={manage.open} />
        </Menu.Dropdown>
      </Menu>
      <ManagePersonGroupsModal opened={manageOpened} onClose={manage.close} />
    </>
  );
}

/** The sort and the group filter as labelled buttons in a desktop header. */
function PeopleToolbar({ groups, group, onGroupChange, sort }: ControlsProps) {
  return (
    <Group gap={4} wrap="nowrap">
      <AlbumSortMenu {...sort} />
      <PersonGroupFilter groups={groups} value={group?.id} onChange={onGroupChange} />
    </Group>
  );
}

/**
 * The People page's header: the count of the people shown and the way to review their faces
 * ("25 faces to review ›"), then the sort and the group filter, folded into one ⋮ beside the title
 * on a phone. With no people yet there is nothing to sort: the page's empty state leads to the faces.
 */
export function PeopleHeader({ loading, shown, ...controls }: Props) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  // Read at once rather than after mounting, so a phone never shows the wide toolbar first
  const isPhone = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`, undefined, { getInitialValueInEffect: false });
  const { total, group } = controls;
  return (
    <PageHeader
      title={t("people")}
      loading={loading}
      subtitle={
        <span className={classes.subtitle}>
          {group
            ? t("personalbum.numberingroup", { count: shown, name: group.name })
            : t("personalbum.numberofpeople", { count: total, peoplelength: total })}
          {total > 0 && (
            <>
              <span aria-hidden>·</span>
              <FacesReviewLink group={group?.id} />
            </>
          )}
        </span>
      }
      actions={total === 0 ? null : isPhone ? <PeopleOverflowMenu {...controls} /> : <PeopleToolbar {...controls} />}
    />
  );
}
