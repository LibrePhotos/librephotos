import type { CreatedFolder } from "@librephotos/api-client";
import { ActionIcon, Button, Group, Text, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconFolderPlus, IconX } from "@tabler/icons-react";
import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api_client/apiError";
import { useCreateFolderMutation } from "../../api_client/folders/hooks/useCreateFolderMutation";
import classes from "./NewFolderRow.module.css";
import { makeNewFolderSchema } from "./NewFolderRow.schema";

type Props = Readonly<{
  /** The folder the new one goes in. */
  parent: string;
  onCreated: (folder: CreatedFolder) => void;
  onCancel: () => void;
}>;

/**
 * Names a new folder inside the selected one (#2035). Not a <form>: the picker sits inside the user
 * edit dialog's form, so Enter creates the folder here instead of saving the user.
 */
export function NewFolderRow({ parent, onCreated, onCancel }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  // The row opens to be typed into.
  useEffect(() => inputRef.current?.focus(), []);
  const { mutate: createFolder, isPending } = useCreateFolderMutation({ reportsErrors: true });
  const form = useForm({
    initialValues: { name: "" },
    validate: schemaResolver(makeNewFolderSchema(t), { sync: true }),
  });

  const submit = form.onSubmit(({ name }) => {
    createFolder(
      { parent, name },
      {
        onSuccess: onCreated,
        onError: (error: unknown) =>
          form.setFieldError("name", (error instanceof ApiError && error.serverMessage) || t("toasts.requestfailed")),
      }
    );
  });

  return (
    <Group gap="xs" align="flex-start" wrap="nowrap" px={4} py={4}>
      <IconFolderPlus size={16} color="var(--mantine-color-yellow-9)" aria-hidden />
      <TextInput
        aria-label={t("directorypicker.foldername")}
        placeholder={t("directorypicker.foldername")}
        description={
          <Text span size="xs" c="dimmed" className={classes.path}>
            {t("directorypicker.newfolderin", { path: parent })}
          </Text>
        }
        inputWrapperOrder={["label", "input", "description", "error"]}
        size="xs"
        flex={1}
        ref={inputRef}
        // Escape closes this row; the user dialog around the picker skips an Escape from here.
        data-mantine-stop-propagation
        {...form.getInputProps("name")}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <Button type="button" size="xs" variant="default" loading={isPending} onClick={() => submit()}>
        {t("directorypicker.create")}
      </Button>
      <ActionIcon variant="subtle" color="gray" aria-label={t("cancel")} onClick={onCancel}>
        <IconX size={16} />
      </ActionIcon>
    </Group>
  );
}
