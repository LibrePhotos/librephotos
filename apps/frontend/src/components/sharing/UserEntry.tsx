import type { ListUser } from "@librephotos/api-client";
import { Avatar, Group, Select, Text, Title } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { parseInstant } from "../../util/dateUtils";
import { avatarSrc } from "./avatarSrc";
import type { MemberRole } from "./memberRoles";

type UserEntryProps = Readonly<{
  item: ListUser;
  role: MemberRole;
  onChange: (role: MemberRole) => void;
}>;

export function getDisplayName(item: Pick<ListUser, "first_name" | "last_name" | "username">) {
  return item.first_name.length > 0 && item.last_name.length > 0
    ? `${item.first_name} ${item.last_name}`
    : item.username;
}

function isMemberRole(value: string | null): value is MemberRole {
  return value === "none" || value === "viewer" || value === "contributor";
}

/** One user of the server in the share dialog, with their role in the album (#464). */
export function UserEntry({ item: user, role, onChange }: UserEntryProps) {
  const { t } = useTranslation();
  const name = getDisplayName(user);

  return (
    // On a phone the role goes under the name, full width, so its label is never cut.
    <Group justify="space-between" gap="xs" key={user.id}>
      <Group wrap="nowrap" miw={0}>
        <Avatar radius="xl" size={50} src={avatarSrc(user)} />
        <div>
          <Title order={4}>{name}</Title>
          {user.date_joined && (
            <Text size="sm" c="dimmed">
              {t("modalphotosshare.joined")} {parseInstant(user.date_joined).toRelative()}
            </Text>
          )}
        </div>
      </Group>
      <Select
        aria-label={t("collab.roleFor", { name })}
        w={{ base: "100%", xs: 170 }}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true, zIndex: 2000 }}
        data={[
          { value: "none", label: t("collab.noAccess") },
          { value: "viewer", label: t("collab.canView") },
          { value: "contributor", label: t("collab.canAdd") },
        ]}
        value={role}
        onChange={value => {
          if (isMemberRole(value) && value !== role) onChange(value);
        }}
      />
    </Group>
  );
}
