import type { LibraryShare } from "@librephotos/api-client";
import { Button, Group, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLibraryPhoto } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "../common/ErrorState";
import { useListFailure } from "../common/useListFailure";
import { UserAvatar } from "../common/UserAvatar";
import { SharingRow } from "../sharing/SharingRow";
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
        <UserAvatar user={share.recipient} />
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

  const hasBody = Boolean(failure) || given.length > 0;
  return (
    <>
      <SharingRow
        icon={<IconLibraryPhoto size={24} stroke={1.5} />}
        title={t("librarySharing.yourLibrary")}
        description={
          given.length > 0
            ? t("librarySharing.yourLibrarySummary", { count: given.length })
            : t("librarySharing.yourLibraryIntro")
        }
        // The page's create action: tonal
        action={
          <Button size="sm" variant="light" onClick={shareDialog.open}>
            {t("librarySharing.shareMyLibrary")}
          </Button>
        }
      >
        {hasBody ? (
          <Stack gap="sm">
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
        ) : null}
      </SharingRow>
      <ShareLibraryModal opened={shareOpened} onClose={shareDialog.close} given={given} />
      {openShare && <LibraryRecipientModal opened onClose={() => setOpenShareId(null)} share={openShare} />}
    </>
  );
}
