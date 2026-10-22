import { ApiError, type ListUser } from "@librephotos/api-client";
import { Alert, Button, Code, Group, Modal, Select, Stack, Text, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconAlertTriangle, IconFolder } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useCheckFileContentsMutation } from "../../api_client/jobs/hooks";
import { useFetchUserListQuery } from "../../api_client/user/hooks";
import { notification } from "../../service/notifications";
import { ICON_SIZE } from "../../uiConstants";
import { ALL_USERS, makeCheckFileContentsSchema } from "./CheckFileContentsModal.schema";

type Scope = Readonly<{ userId: string; folder: string }>;

/** The users whose library can be checked: those with a scan directory. */
function usersWithLibrary(users: readonly ListUser[] | undefined): ListUser[] {
  return (users ?? []).filter(user => Boolean(user.scan_directory));
}

/** `manage.py rehash_files` with the same scope, for admins who prefer the shell. */
function rehashCommand(username: string | undefined, folder: string): string {
  const parts = ["python manage.py rehash_files"];
  if (username) parts.push(`--user ${username}`);
  if (username && folder) parts.push(`--path ${folder}`);
  return parts.join(" ");
}

type FormProps = Readonly<{ onClose: () => void }>;

/** The form inside the modal body, which Mantine unmounts on close: every opening starts from all users. */
function CheckFileContentsForm({ onClose }: FormProps) {
  const { t } = useTranslation();
  const { data: users } = useFetchUserListQuery();
  const check = useCheckFileContentsMutation({ reportsErrors: true });
  const form = useForm({
    initialValues: { userId: ALL_USERS, folder: "" },
    validate: schemaResolver(makeCheckFileContentsSchema(t), { sync: true }),
    validateInputOnChange: ["folder"],
  });
  const candidates = usersWithLibrary(users);
  const chosen = candidates.find(user => String(user.id) === form.values.userId);
  const folder = chosen ? form.values.folder.trim() : "";

  const start = (values: Scope) =>
    check.mutate(
      { user_id: chosen ? chosen.id : null, folder: chosen ? values.folder.trim() : "" },
      {
        onSuccess: onClose,
        onError: error => {
          // A folder outside the scan directory, or one that does not exist: said on the field.
          if (error instanceof ApiError && error.status === 400) {
            form.setFieldError("folder", error.serverMessage ?? t("checkfilecontents.folderinvalid"));
            return;
          }
          notification.saveFailed(error instanceof ApiError ? error.serverMessage : null);
        },
      }
    );

  return (
    // A form, so Enter starts it too
    <form onSubmit={form.onSubmit(start)}>
      <Stack>
        <Text size="sm">{t("checkfilecontents.intro")}</Text>
        <Select
          label={t("checkfilecontents.users")}
          data={[
            { value: ALL_USERS, label: t("checkfilecontents.allusers") },
            ...candidates.map(user => ({ value: String(user.id), label: user.username })),
          ]}
          allowDeselect={false}
          {...form.getInputProps("userId")}
        />
        <TextInput
          label={t("checkfilecontents.folder")}
          description={
            chosen
              ? t("checkfilecontents.folderdescription", { directory: chosen.scan_directory })
              : t("checkfilecontents.folderneedsuser")
          }
          placeholder={t("checkfilecontents.folderplaceholder")}
          leftSection={<IconFolder size={ICON_SIZE.inline} />}
          disabled={!chosen}
          {...form.getInputProps("folder")}
        />
        <Alert
          color="yellow"
          title={t("checkfilecontents.longrun")}
          icon={<IconAlertTriangle size={ICON_SIZE.inline} />}
        >
          {t("checkfilecontents.longrundescription")}
        </Alert>
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            {t("checkfilecontents.command")}
          </Text>
          <Code block>{rehashCommand(chosen?.username, folder)}</Code>
        </Stack>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" loading={check.isPending}>
            {t("checkfilecontents.start")}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

type Props = Readonly<{ opened: boolean; onClose: () => void }>;

/** Choose whose files Check file contents reads (#2040): every user, or one user and a folder. */
export function CheckFileContentsModal({ opened, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Modal title={t("checkfilecontents.title")} opened={opened} onClose={onClose}>
      <CheckFileContentsForm onClose={onClose} />
    </Modal>
  );
}
