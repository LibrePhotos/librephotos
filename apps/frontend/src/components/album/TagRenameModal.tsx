import { Button, Group, Modal, Stack, TextInput } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React, { useEffect, useEffectEvent } from "react";
import { useTranslation } from "react-i18next";
import { makeTagRenameSchema } from "./TagRenameModal.schema";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The tag being renamed; its name labels the input. */
  tagName: string | undefined;
  /** Every tag name, for the duplicate check. */
  existingNames: readonly string[];
  onSubmit: (newName: string) => void;
}>;

export function TagRenameModal({ opened, onClose, tagName, existingNames, onSubmit }: Props) {
  const { t } = useTranslation();
  const form = useForm({
    initialValues: { name: "" },
    validate: schemaResolver(makeTagRenameSchema(t, existingNames), { sync: true }),
    validateInputOnChange: ["name"],
    transformValues: ({ name }) => ({ name: name.trim() }),
  });
  // Every opening starts with an empty name. `form` is a new object every render, not a trigger.
  const startOver = useEffectEvent(() => form.reset());
  useEffect(() => {
    if (opened) startOver();
  }, [opened]);
  const rename = form.onSubmit(({ name }) => {
    onSubmit(name);
    onClose();
  });

  return (
    <Modal size="sm" opened={opened} onClose={onClose} title={t("tagalbum.renametag")}>
      <Stack>
        <TextInput label={tagName} placeholder={t("tagalbum.tagplaceholder")} {...form.getInputProps("name")} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!form.isValid()} onClick={() => rename()}>
            {t("rename")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
