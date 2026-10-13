import { Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import { schemaResolver, useForm } from "@mantine/form";
import React, { useEffect, useEffectEvent } from "react";
import { useTranslation } from "react-i18next";
import { makeTagMergeSchema } from "./TagMergeModal.schema";

type Tag = { id: number; name: string };

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  /** The tag the others are merged into; it is left out of the choices. */
  target: Tag | null;
  tags: readonly Tag[];
  onSubmit: (source: Tag) => void;
}>;

export function TagMergeModal({ opened, onClose, target, tags, onSubmit }: Props) {
  const { t } = useTranslation();
  const form = useForm<{ source: string | null }>({
    initialValues: { source: null },
    validate: schemaResolver(makeTagMergeSchema(t), { sync: true }),
  });
  // Every opening starts with no tag chosen. `form` is a new object every render, not a trigger.
  const startOver = useEffectEvent(() => form.reset());
  useEffect(() => {
    if (opened) startOver();
  }, [opened]);
  const merge = form.onSubmit(({ source: sourceId }) => {
    const source = tags.find(tag => `${tag.id}` === sourceId);
    if (source) {
      onSubmit(source);
    }
    onClose();
  });

  return (
    <Modal size="sm" opened={opened} onClose={onClose} title={t("tagalbum.mergetag")}>
      <Stack>
        <Text>{t("tagalbum.mergeexplanation", { name: target?.name ?? "" })}</Text>
        <Select
          searchable
          placeholder={t("tagalbum.tagplaceholder")}
          data={tags.filter(tag => tag.id !== target?.id).map(tag => ({ value: `${tag.id}`, label: tag.name }))}
          {...form.getInputProps("source")}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button disabled={!form.isValid()} onClick={() => merge()}>
            {t("tagalbum.merge")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
