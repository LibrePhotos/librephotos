import type { LibraryShare } from "@librephotos/api-client";
import { Avatar, Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLibraryPhoto } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { LibraryRecipientModal } from "./LibraryRecipientModal";
import { LibraryShareChips } from "./LibraryShareChips";
import { firstName, personName, shareDate, switchesOf } from "./libraryShareFields";
import { ShareLibraryModal } from "./ShareLibraryModal";
import { useLibraryShares } from "./useLibraryShares";

function RecipientRow({ share, onOpen }: Readonly<{ share: LibraryShare; onOpen: () => void }>) {
  const { t } = useTranslation();
  const name = personName(share.recipient);
  const since = shareDate(share);
  return (
    <Group justify="space-between" wrap="wrap" gap="xs">
      <Group gap="sm" wrap="nowrap" miw={0}>
        <Avatar radius="xl" name={name} color="initials" />
        <Stack gap={2} miw={0}>
          <Text fw={500} size="sm">
            {name}
          </Text>
          <Text size="xs" c="dimmed">
            {share.show_in_timeline
              ? t("librarySharing.inTheirTimeline", { date: since })
              : t("librarySharing.keptSeparate", { date: since })}
          </Text>
          <LibraryShareChips switches={switchesOf(share)} />
        </Stack>
      </Group>
      <Button size="xs" variant="default" onClick={onOpen}>
        {t("librarySharing.whatSees", { name: firstName(share.recipient) })}
      </Button>
    </Group>
  );
}

/**
 * The top of the Sharing overview for the owner (#2731): who has my library and, per person, what
 * they see. "Share my library" starts a new share; "What Ben sees" changes or ends one.
 */
export function YourLibrarySection() {
  const { t } = useTranslation();
  const { query, given } = useLibraryShares();
  const failure = useListFailure(query);
  const [shareOpened, shareDialog] = useDisclosure(false);
  const [openShareId, setOpenShareId] = useState<number | null>(null);
  const openShare = given.find(share => share.id === openShareId);

  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="sm" wrap="nowrap">
            <IconLibraryPhoto size={24} stroke={1.5} color="var(--mantine-color-blue-6)" aria-hidden />
            <div>
              <Title order={4}>{t("librarySharing.yourLibrary")}</Title>
              <Text size="sm" c="dimmed">
                {given.length > 0
                  ? t("librarySharing.yourLibrarySummary", { count: given.length })
                  : t("librarySharing.yourLibraryIntro")}
              </Text>
            </div>
          </Group>
          <Button size="sm" onClick={shareDialog.open}>
            {t("librarySharing.shareMyLibrary")}
          </Button>
        </Group>
        {failure && <ErrorState failure={failure} compact />}
        {given.map(share => (
          <RecipientRow key={share.id} share={share} onOpen={() => setOpenShareId(share.id)} />
        ))}
        {given.length > 0 && (
          <Text size="xs" c="dimmed">
            {t("librarySharing.footnote")}
          </Text>
        )}
      </Stack>
      <ShareLibraryModal opened={shareOpened} onClose={shareDialog.close} given={given} />
      {openShare && <LibraryRecipientModal opened onClose={() => setOpenShareId(null)} share={openShare} />}
    </Paper>
  );
}
