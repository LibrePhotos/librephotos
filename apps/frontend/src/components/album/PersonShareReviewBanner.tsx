import { Alert, Button, Group, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconEyeQuestion } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { usePersonSharingQuery } from "../../api_client/albums/hooks";
import { ICON_SIZE } from "../../uiConstants";
import { PersonShareReviewModal } from "./PersonShareReviewModal";

type Props = Readonly<{ person: Readonly<{ id: number | string; name: string }> }>;

/**
 * On a shared person's page (#668): how many photos labelled since the person was shared wait for
 * the owner's review, and the button to review them. Nothing while none wait or nobody has it.
 */
export function PersonShareReviewBanner({ person }: Props) {
  const { t } = useTranslation();
  const { data: sharing } = usePersonSharingQuery(Number(person.id));
  const [opened, dialog] = useDisclosure(false);
  if (!sharing || sharing.recipients.length === 0 || sharing.pending_count === 0) return null;
  return (
    <>
      <Alert variant="light" color="yellow" icon={<IconEyeQuestion size={ICON_SIZE.menu} />} mx={10} mb="xs">
        <Group justify="space-between" gap="xs">
          <Text size="sm">{t("personshare.pendingBanner", { count: sharing.pending_count, name: person.name })}</Text>
          <Button size="xs" onClick={dialog.open}>
            {t("personshare.review")}
          </Button>
        </Group>
      </Alert>
      <PersonShareReviewModal opened={opened} onClose={dialog.close} person={person} />
    </>
  );
}
