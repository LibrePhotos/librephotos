import type { PersonGroup } from "@librephotos/api-client";
import { Button, Group } from "@mantine/core";
import { IconFaceId, IconUsers } from "@tabler/icons-react";
import { useNavigate } from "@tanstack/react-router";
import React from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE } from "../../uiConstants";
import { PageHeader } from "../PageHeader";
import { PersonGroupFilter } from "./PersonGroupFilter";

type Props = Readonly<{
  loading: boolean;
  /** How many people the user has, and how many the page shows. */
  total: number;
  shown: number;
  groups: readonly PersonGroup[];
  /** The group the page is narrowed to (#1126), if any. */
  group: PersonGroup | undefined;
  onGroupChange: (group: number | undefined) => void;
  /** The sort button (#620), shown while there are people to sort. */
  sortMenu: ReactNode;
}>;

/** The People page's header: the count of the people shown, the sort, the group filter and Manage faces. */
export function PeopleHeader({ loading, total, shown, groups, group, onGroupChange, sortMenu }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <PageHeader
      icon={IconUsers}
      title={t("people")}
      loading={loading}
      subtitle={
        group
          ? t("personalbum.numberingroup", { count: shown, name: group.name })
          : t("personalbum.numberofpeople", { count: total, peoplelength: total })
      }
      actions={
        <Group gap="xs" wrap="nowrap">
          {total > 0 && sortMenu}
          {total > 0 && <PersonGroupFilter groups={groups} value={group?.id} onChange={onGroupChange} />}
          <Button
            leftSection={<IconFaceId size={ICON_SIZE.toolbar} />}
            variant="light"
            color="orange"
            onClick={() => void navigate({ to: "/faces" })}
          >
            {t("personalbum.managefaces")}
          </Button>
        </Group>
      }
    />
  );
}
