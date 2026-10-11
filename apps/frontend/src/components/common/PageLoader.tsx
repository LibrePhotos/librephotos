import { Center, Loader, Stack, Text } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

type PageLoaderProps = Readonly<{
  /** Shown under the spinner; also the accessible name. Defaults to "Loading...". */
  label?: string;
}>;

/**
 * The first load of a page or section: one centred spinner in a block of fixed
 * minimum height, so the layout does not jump. A refetch of data that is
 * already on screen keeps an inline `<Loader size="xs" />` next to its title.
 */
export function PageLoader({ label }: PageLoaderProps) {
  const { t } = useTranslation();
  const name = label ?? t("loading");

  return (
    <Center mih={240} py="xl" role="status" aria-label={name}>
      <Stack align="center" gap="sm">
        <Loader size="lg" />
        {label !== undefined && (
          <Text c="dimmed" size="sm" ta="center">
            {label}
          </Text>
        )}
      </Stack>
    </Center>
  );
}
