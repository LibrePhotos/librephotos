import type { ListUser, PersonSharing } from "@librephotos/api-client";
import { Avatar, Button, Divider, Group, Modal, ScrollArea, Stack, Switch, Text, Title } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { usePersonSharingQuery, useSetPersonSharingMutation } from "../../api_client/albums/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { PageLoader } from "../common/PageLoader";
import { avatarSrc } from "../sharing/avatarSrc";
import { getDisplayName } from "../sharing/UserEntry";
import filterUsers from "../sharing/utils";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  person: Readonly<{ id: number | string; name: string }>;
}>;

function recipientIds(sharing: PersonSharing | undefined): number[] {
  return sharing?.recipients.map(user => user.id) ?? [];
}

/** The ids with `user` added or taken out. */
function toggled(ids: number[], user: ListUser, on: boolean): number[] {
  const others = ids.filter(id => id !== user.id);
  return on ? [...others, user.id] : others;
}

/**
 * Person ⋮ → Share (#668): who sees the person's photos (only ever to look at them), and whether
 * they see where the photos were taken and who else is on them. Every change saves at once.
 */
export function SharePersonModal({ opened, onClose, person }: Props) {
  const { t } = useTranslation();
  const { data: sharing } = usePersonSharingQuery(Number(person.id), opened);
  const { data: users } = useFetchUserListQuery();
  const { data: currentUser } = useCurrentUserSelfDetailsQuery();
  const save = useSetPersonSharingMutation(Number(person.id));
  const ids = recipientIds(sharing);
  const update = (change: { recipient_ids?: number[]; share_location?: boolean; share_other_people?: boolean }) =>
    save.mutate({ recipient_ids: ids, ...change });

  return (
    <Modal opened={opened} onClose={onClose} title={t("personshare.title", { name: person.name })}>
      {sharing ? (
        <Stack>
          <Text size="sm">{t("personshare.intro", { name: person.name })}</Text>
          <Title order={5}>{t("personshare.shareWith")}</Title>
          <ScrollArea.Autosize mah={260}>
            <Stack gap="xs">
              {filterUsers("", currentUser?.id ?? 0, users).map(user => (
                <Group key={user.id} justify="space-between" wrap="nowrap">
                  <Group wrap="nowrap" gap="sm">
                    <Avatar radius="xl" size={36} src={avatarSrc(user)} alt="" />
                    <Text size="sm">{getDisplayName(user)}</Text>
                  </Group>
                  <Switch
                    aria-label={t("personshare.accessFor", { name: getDisplayName(user) })}
                    checked={ids.includes(user.id)}
                    onChange={event => update({ recipient_ids: toggled(ids, user, event.currentTarget.checked) })}
                  />
                </Group>
              ))}
            </Stack>
          </ScrollArea.Autosize>
          <Divider />
          <Title order={5}>{t("personshare.whatTheySee")}</Title>
          <Switch
            label={t("personshare.location")}
            checked={sharing.share_location}
            onChange={event => update({ share_location: event.currentTarget.checked })}
          />
          <Switch
            label={t("personshare.otherPeople")}
            checked={sharing.share_other_people}
            onChange={event => update({ share_other_people: event.currentTarget.checked })}
          />
          <Text size="xs" c="dimmed">
            {t("personshare.never")}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("personshare.done")}
            </Button>
          </Group>
        </Stack>
      ) : (
        <PageLoader />
      )}
    </Modal>
  );
}
