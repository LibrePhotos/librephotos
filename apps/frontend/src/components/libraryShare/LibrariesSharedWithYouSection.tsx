import type { LibraryShare } from "@librephotos/api-client";
import { Group, Stack, Text } from "@mantine/core";
import { IconLibraryPhoto } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { UserAvatar } from "../common/UserAvatar";
import { SharingRow } from "../sharing/SharingRow";
import { personName, shareDate } from "./libraryShareFields";
import { TimelineSwitch } from "./TimelineSwitch";
import { useLibraryShares } from "./useLibraryShares";

function LibraryRow({ share }: Readonly<{ share: LibraryShare }>) {
  const { t } = useTranslation();
  const name = personName(share.owner);
  return (
    <Group justify="space-between" wrap="wrap" gap="xs">
      <Group gap="sm" wrap="nowrap" miw={0}>
        <UserAvatar user={share.owner} />
        <div>
          <Link to="/sharing/library/$userId" params={{ userId: String(share.owner.id) }}>
            <Text component="span" fw={500} size="sm" c="var(--mantine-color-anchor)">
              {t("librarySharing.libraryOf", { name })}
            </Text>
          </Link>
          <Text size="xs" c="dimmed">
            {t("librarySharing.librarySummary", { count: share.photo_count, date: shareDate(share) })}
          </Text>
        </div>
      </Group>
      <TimelineSwitch share={share} />
    </Group>
  );
}

/**
 * The libraries other users share with me (#2731), on the Sharing overview: each opens as a
 * read-only library page, and each has my "Show in my timeline" switch. Hidden until someone
 * shares, so a single-user server shows nothing new.
 */
export function LibrariesSharedWithYouSection() {
  const { t } = useTranslation();
  const { received } = useLibraryShares();
  if (received.length === 0) return null;
  return (
    <SharingRow
      icon={<IconLibraryPhoto size={24} stroke={1.5} />}
      title={t("librarySharing.librariesWithYou")}
      description={t("sharing.userCount", { count: received.length })}
    >
      <Stack gap="sm">
        {received.map(share => (
          <LibraryRow key={share.id} share={share} />
        ))}
      </Stack>
    </SharingRow>
  );
}
