import type { PersonGroup } from "@librephotos/api-client";
import { ActionIcon, Button, Indicator, Menu, Text, Tooltip, useMantineTheme } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconCheck, IconChevronDown, IconSettings, IconUsers, IconUsersGroup } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, TOOLBAR_CONTROL_HEIGHT } from "../../uiConstants";
import { toolbarLook } from "../common/toolbarLook";
import { ManagePersonGroupsModal } from "./ManagePersonGroupsModal";

type Props = Readonly<{
  groups: readonly PersonGroup[];
  /** The group shown, or undefined for everybody. */
  value: number | undefined;
  onChange: (group: number | undefined) => void;
}>;

function GroupItem({
  label,
  count,
  checked,
  onClick,
}: Readonly<{
  label: string;
  count?: number;
  checked: boolean;
  onClick: () => void;
}>) {
  return (
    <Menu.Item rightSection={checked ? <IconCheck size={ICON_SIZE.inline} /> : null} onClick={onClick}>
      {label}
      {count !== undefined && (
        <Text span size="xs" c="dimmed" ml={6}>
          {count}
        </Text>
      )}
    </Menu.Item>
  );
}

/**
 * The People page's and the face dashboard's group filter (#1126): one menu button that names the
 * current group, like the media filter (#2215). Its last item manages the groups.
 */
export function PersonGroupFilter({ groups, value, onChange }: Props) {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  // On a phone the header has no room for a labelled button next to the title.
  const compact = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const [manageOpened, manage] = useDisclosure(false);
  const current = groups.find(group => group.id === value);
  const label = current?.name ?? t("persongroups.all");
  const filtered = current !== undefined;
  const look = toolbarLook(filtered);
  const Icon = filtered ? IconUsersGroup : IconUsers;

  return (
    <>
      <Menu position="bottom-end" shadow="md">
        {compact ? (
          // The dot goes on the Indicator, outside the target, so the ActionIcon itself carries
          // the menu's aria attributes.
          <Indicator size={8} disabled={!filtered}>
            <Menu.Target>
              <Tooltip label={t("persongroups.button", { current: label })} position="bottom">
                <ActionIcon {...look} size="lg" aria-label={t("persongroups.button", { current: label })}>
                  <Icon size={ICON_SIZE.toolbar} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
          </Indicator>
        ) : (
          <Menu.Target>
            <Button
              {...look}
              h={TOOLBAR_CONTROL_HEIGHT}
              leftSection={<Icon size={18} />}
              rightSection={<IconChevronDown size={ICON_SIZE.inline} />}
              aria-label={t("persongroups.button", { current: label })}
            >
              {label}
            </Button>
          </Menu.Target>
        )}
        <Menu.Dropdown aria-label={t("persongroups.title")}>
          <PersonGroupMenuItems groups={groups} value={value} onChange={onChange} onManage={manage.open} />
        </Menu.Dropdown>
      </Menu>
      <ManagePersonGroupsModal opened={manageOpened} onClose={manage.close} />
    </>
  );
}

type ItemsProps = Props & Readonly<{ onManage: () => void }>;

/**
 * The group filter's items: everybody, each group with its count, and Manage groups. Also the
 * group section of the People page's single overflow menu on a phone (PeopleHeader).
 */
export function PersonGroupMenuItems({ groups, value, onChange, onManage }: ItemsProps) {
  const { t } = useTranslation();
  return (
    <>
      <GroupItem
        label={t("persongroups.all")}
        checked={!groups.some(group => group.id === value)}
        onClick={() => onChange(undefined)}
      />
      {groups.length > 0 && <Menu.Divider />}
      {groups.map(group => (
        <GroupItem
          key={group.id}
          label={group.name}
          count={group.person_count}
          checked={group.id === value}
          onClick={() => onChange(group.id)}
        />
      ))}
      <Menu.Divider />
      <Menu.Item leftSection={<IconSettings size={ICON_SIZE.menu} />} onClick={onManage}>
        {t("persongroups.manage")}
      </Menu.Item>
    </>
  );
}
