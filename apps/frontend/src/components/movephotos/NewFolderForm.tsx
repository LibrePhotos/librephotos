import { Button, Group, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import { IconFolderPlus } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { DisabledReason } from "../common/DisabledReason";
import { makeNewFolderSchema, type NewFolderValues } from "./NewFolderForm.schema";

type Props = Readonly<{
  /** The folder the new one goes in; without one there is nowhere to make it yet. */
  parent: string | null;
  onCreate: (name: string) => void;
  onCancel: () => void;
}>;

/** Names a new folder inside the picked one. Nothing is made on disk until the photos move into it. */
export function NewFolderForm({ parent, onCreate, onCancel }: Props) {
  const { t } = useTranslation();
  const initialValues: NewFolderValues = { name: "" };
  const form = useForm({
    initialValues,
    validate: schemaResolver(makeNewFolderSchema(t), { sync: true }),
    validateInputOnChange: true,
  });
  const submit = form.onSubmit(values => {
    onCreate(values.name.trim());
    form.reset();
  });
  const reason = parent === null ? t("movephotos.pickparent") : !form.isValid() && t("movephotos.foldername");
  return (
    <form onSubmit={submit}>
      <Group align="flex-start" gap="xs" wrap="nowrap">
        <TextInput
          flex={1}
          size="xs"
          data-autofocus
          aria-label={t("movephotos.newfoldername")}
          placeholder={t("movephotos.newfoldername")}
          leftSection={<IconFolderPlus size={14} />}
          {...form.getInputProps("name")}
        />
        <DisabledReason reason={reason}>
          <Button type="submit" size="xs">
            {t("movephotos.addfolder")}
          </Button>
        </DisabledReason>
        <Button size="xs" variant="default" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </Group>
    </form>
  );
}
