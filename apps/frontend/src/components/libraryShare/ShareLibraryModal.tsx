import type { LibraryShare, ListUser } from "@librephotos/api-client";
import { Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { useMediaQuery } from "@mantine/hooks";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCreateLibraryShareMutation } from "../../api_client/libraryShares/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { useCurrentUserSelfDetailsQuery } from "../../api_client/user/hooks/useCurrentUserSelfDetailsQuery";
import { sharerName } from "../sharing/sharerGroups";
import { ALL_OFF } from "./libraryShareFields";
import { AlwaysAndNeverShared, LibrarySwitches } from "./LibrarySwitches";
import { makeShareLibrarySchema, type ShareLibraryValues } from "./ShareLibraryModal.schema";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The shares I already gave: those users are listed as having access. */
  given: readonly LibraryShare[];
}>;

/** The users I can pick: everyone else, those who have my library already listed but disabled. */
function recipientOptions(users: readonly ListUser[], selfId: number | undefined, given: readonly LibraryShare[]) {
  const shared = new Set(given.map(share => share.recipient.id));
  return users
    .filter(user => user.id !== selfId)
    .map(user => ({
      value: String(user.id),
      label: sharerName(user, user.username),
      disabled: shared.has(user.id),
    }));
}

/** "Share my library" (#2731): pick a user, choose what they see (all off), share. */
export function ShareLibraryModal({ opened, onClose, given }: Props) {
  const { t } = useTranslation();
  const fullScreen = useMediaQuery("(max-width: 576px)");
  const { data: users = [] } = useFetchUserListQuery();
  const { data: self } = useCurrentUserSelfDetailsQuery();
  const create = useCreateLibraryShareMutation();
  const initialValues: ShareLibraryValues = { recipientId: "", ...ALL_OFF };
  const form = useForm({
    initialValues,
    validate: schemaResolver(makeShareLibrarySchema(t), { sync: true }),
  });
  const options = recipientOptions(users, self?.id, given);
  const recipient = options.find(option => option.value === form.values.recipientId);

  const close = () => {
    form.reset();
    onClose();
  };

  const submit = form.onSubmit(({ recipientId, ...switches }) =>
    create.mutate(
      { recipientId: Number(recipientId), recipientName: recipient?.label ?? "", switches },
      { onSuccess: close }
    )
  );

  return (
    <Modal opened={opened} onClose={close} title={t("librarySharing.shareMyLibrary")} fullScreen={fullScreen}>
      <form onSubmit={submit}>
        <Stack>
          <Text size="sm" c="dimmed">
            {t("librarySharing.shareIntro")}
          </Text>
          {options.length === 0 ? (
            <Text size="sm">{t("librarySharing.noOtherUsers")}</Text>
          ) : (
            <Select
              label={t("librarySharing.with")}
              placeholder={t("librarySharing.searchUsers")}
              data={options.map(option => ({
                ...option,
                label: option.disabled ? `${option.label} (${t("librarySharing.alreadyHasAccess")})` : option.label,
              }))}
              searchable
              nothingFoundMessage={t("librarySharing.noOtherUsers")}
              value={form.values.recipientId || null}
              error={form.errors.recipientId}
              onChange={value => form.setFieldValue("recipientId", value ?? "")}
            />
          )}
          <Text size="sm" fw={500}>
            {t("librarySharing.whatTheySee")}
          </Text>
          <LibrarySwitches values={form.values} onChange={(field, value) => form.setFieldValue(field, value)} />
          <AlwaysAndNeverShared />
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {t("cancel")}
            </Button>
            <Button type="submit" loading={create.isPending}>
              {recipient ? t("librarySharing.shareWith", { name: recipient.label }) : t("librarySharing.share")}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
