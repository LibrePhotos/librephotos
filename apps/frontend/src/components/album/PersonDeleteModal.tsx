import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { Person } from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Names the person and says what happens to their faces; without it the question is generic. */
  person?: Pick<Person, "name" | "face_count">;
}>;

export function PersonDeleteModal({ opened, onClose, onConfirm, person }: Props) {
  const { t } = useTranslation();
  return (
    <Modal
      opened={opened}
      title={person ? t("personalbum.deletepersonnamed", { name: person.name }) : t("personalbum.deleteperson")}
      onClose={onClose}
      returnFocus={false}
    >
      <Stack>
        {person ? (
          <>
            <Text size="sm">{t("personalbum.deletepersonremoved", { name: person.name })}</Text>
            {person.face_count > 0 && (
              <Alert variant="light" color="gray" icon={<IconInfoCircle size={ICON_SIZE.inline} />}>
                {t("personalbum.deletepersonfaces", { count: person.face_count, name: person.name })}
              </Alert>
            )}
          </>
        ) : (
          <Text size="sm">{t("personalbum.deletepersondescription")}</Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button
            color="red"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {t("delete")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
