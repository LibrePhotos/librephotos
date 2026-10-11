import { Button, Group, Modal, Select, Stack, Text } from "@mantine/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

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
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  // Every opening starts with no tag chosen
  useEffect(() => {
    if (opened) setMergeSource(null);
  }, [opened]);

  return (
    <Modal size="sm" opened={opened} onClose={onClose} title={t("tagalbum.mergetag")}>
      <Stack>
        <Text>{t("tagalbum.mergeexplanation", { name: target?.name ?? "" })}</Text>
        <Select
          searchable
          value={mergeSource}
          onChange={setMergeSource}
          placeholder={t("tagalbum.tagplaceholder")}
          data={tags.filter(tag => tag.id !== target?.id).map(tag => ({ value: `${tag.id}`, label: tag.name }))}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="green"
            disabled={!mergeSource}
            onClick={() => {
              const source = tags.find(tag => `${tag.id}` === mergeSource);
              if (source) {
                onSubmit(source);
              }
              onClose();
            }}
          >
            {t("tagalbum.merge")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
