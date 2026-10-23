import type { UserAlbum } from "@librephotos/api-client";
import { Switch, Table, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSetAlbumMembershipMutation } from "../../api_client/albums/hooks";
import { ceilingAllows, MEMBER_FIELDS } from "./memberFields";

type Props = Readonly<{
  album: UserAlbum;
}>;

/**
 * What the other members of an album see of the photos you add (#464): per detail, what the album
 * allows, your own switch, and the result ("both must allow"). Your switch saves at once.
 */
export function ConsentTable({ album }: Props) {
  const { t } = useTranslation();
  const setMembership = useSetAlbumMembershipMutation();
  return (
    <Table withRowBorders={false} verticalSpacing={4} horizontalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t("collab.detail")}</Table.Th>
          <Table.Th>{t("collab.albumAllows")}</Table.Th>
          <Table.Th>{t("collab.youAllow")}</Table.Th>
          <Table.Th>{t("collab.shown")}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {MEMBER_FIELDS.map(field => {
          const label = t(field.label);
          const allowed = ceilingAllows(album, field);
          const mine = album.my_switches?.[field.member] ?? false;
          const shown = allowed && mine;
          return (
            <Table.Tr key={field.member}>
              <Table.Th scope="row" fw={400}>
                {label}
              </Table.Th>
              <Table.Td>
                <Text size="sm" c={allowed ? undefined : "dimmed"}>
                  {allowed ? t("collab.yes") : t("collab.no")}
                </Text>
              </Table.Td>
              <Table.Td>
                <Switch
                  size="sm"
                  aria-label={t("collab.allowFor", { field: label })}
                  checked={mine}
                  onChange={event =>
                    setMembership.mutate({
                      albumId: String(album.id),
                      switches: { [field.member]: event.currentTarget.checked },
                    })
                  }
                />
              </Table.Td>
              <Table.Td>
                <Text size="sm" fw={600} c={shown ? "teal" : "dimmed"}>
                  {shown ? t("collab.yes") : t("collab.no")}
                </Text>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}
