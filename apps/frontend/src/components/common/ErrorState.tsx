import { Button, Center, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconCloudOff } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "./EmptyState";
import type { ListFailure } from "./useListFailure";

type ErrorStateProps = Readonly<{
  /** From `useListFailure`: Retry asks the server again (the failed query's `refetch`). */
  failure: ListFailure;
  /** The small size, for a card or a table row instead of a whole page or section. */
  compact?: boolean;
}>;

/**
 * A list or page whose request failed, in place of its empty state: an empty
 * state there would tell the user their library is empty when the server did
 * not answer. `useListFailure` gives the failure, and none when only a
 * background refetch failed with data still on screen.
 */
export function ErrorState({ failure, compact = false }: ErrorStateProps) {
  const { t } = useTranslation();

  if (!compact) {
    return (
      <div role="alert">
        <EmptyState
          icon={<IconCloudOff size={40} />}
          iconColor="red"
          title={t("errorstate.title")}
          description={t("errorstate.description")}
          actionLabel={t("errorstate.retry")}
          onAction={failure.onRetry}
          actionLoading={failure.retrying}
        />
      </div>
    );
  }

  return (
    <Center py="md" role="alert">
      <Stack align="center" gap="xs" maw={400}>
        <ThemeIcon size={40} radius="xl" variant="light" color="red">
          <IconCloudOff size={22} />
        </ThemeIcon>
        <Text fw={700} ta="center">
          {t("errorstate.title")}
        </Text>
        <Text size="sm" c="dimmed" ta="center">
          {t("errorstate.description")}
        </Text>
        <Button size="xs" variant="light" onClick={failure.onRetry} loading={failure.retrying}>
          {t("errorstate.retry")}
        </Button>
      </Stack>
    </Center>
  );
}
