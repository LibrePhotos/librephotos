import type { LibraryShare } from "@librephotos/api-client";
import { Avatar, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconLibraryPhoto } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { personName, shareDate } from "./libraryShareFields";
import { TimelineSwitch } from "./TimelineSwitch";
import { useLibraryShares } from "./useLibraryShares";

function LibraryRow({ share }: Readonly<{ share: LibraryShare }>) {
  const { t } = useTranslation();
  const name = personName(share.owner);
  return (
    <Group justify="space-between" wrap="wrap" gap="xs">
      <Group gap="sm" wrap="nowrap" miw={0}>
        <Avatar radius="xl" name={name} color="initials" />
        <div>
          <Link to="/sharing/library/$userId" params={{ userId: String(share.owner.id) }}>
            <Text component="span" fw={500} size="sm" c="blue">
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
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Group gap="sm" wrap="nowrap">
          <IconLibraryPhoto size={24} stroke={1.5} color="var(--mantine-color-green-6)" aria-hidden />
          <div>
            <Title order={4}>{t("librarySharing.librariesWithYou")}</Title>
            <Text size="sm" c="dimmed">
              {t("sharing.userCount", { count: received.length })}
            </Text>
          </div>
        </Group>
        {received.map(share => (
          <LibraryRow key={share.id} share={share} />
        ))}
      </Stack>
    </Paper>
  );
}
