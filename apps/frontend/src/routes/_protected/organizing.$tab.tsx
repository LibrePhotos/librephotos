/**
 * Unified Stacks & Duplicates page - combines both functionalities with tabs.
 *
 * This page provides a unified interface for:
 * - Duplicates: Finding and removing duplicate photos to save storage space
 * - Stacks: Organizing related photos together (bursts, brackets, manual stacks)
 */
import { Badge, Box, Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconCopy, IconLayersSubtract } from "@tabler/icons-react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDuplicateStatsQuery } from "../../api_client/duplicates";
import { useStackStatsQuery } from "../../api_client/stacks";
import { countListedStacks } from "../../api_client/stacks/types";
import { DuplicatesPageContent } from "../../components/stacks-duplicates/DuplicatesPageContent";
import { StacksPageContent } from "../../components/stacks-duplicates/StacksPageContent";

type StacksDuplicatesSearchParams = {
  type?: string;
  status?: string;
};

export const Route = createFileRoute("/_protected/organizing/$tab")({
  component: StacksDuplicatesPage,
  // The pages read their filters from the URL themselves and only take the ones they know
  validateSearch: (search: Record<string, unknown>): StacksDuplicatesSearchParams => ({
    type: typeof search.type === "string" ? search.type : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
  }),
});

function StacksDuplicatesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tab } = Route.useParams();
  const { data: duplicateStats } = useDuplicateStatsQuery();
  const { data: stackStats } = useStackStatsQuery();
  // Phones drop the tab icons so both labels and counts fit on one row. Read synchronously
  // (no SSR here) so the icons do not flash in on the first frame
  const isPhone = useMediaQuery("(max-width: 36em)", undefined, { getInitialValueInEffect: false });

  // Validate tab parameter
  if (tab !== "duplicates" && tab !== "stacks") {
    return <Navigate to="/organizing/$tab" params={{ tab: "duplicates" }} replace />;
  }

  const getSubtitle = () => {
    if (tab === "duplicates") {
      return t("duplicates.subtitle", "Find and remove duplicate photos to save storage space");
    }
    return t("stacks.subtitle", "Group burst sequences, exposure brackets and related photos");
  };

  const handleTabChange = (value: string | null) => {
    if (value && (value === "duplicates" || value === "stacks")) {
      navigate({
        to: "/organizing/$tab",
        params: { tab: value },
      });
    }
  };

  return (
    // p={10}, HeaderComponent's inset, so the header and content line up with the other
    // pages' (with "md" both sat 6px further in than on People or Albums)
    <Stack gap="lg" p={10}>
      {/* Shared header, laid out like HeaderComponent, with the sidebar's Organizing icon.
          The page's own padding stands in for HeaderComponent's. */}
      <Group gap="sm" wrap="nowrap">
        <Box style={{ display: "flex", flexShrink: 0 }}>
          <IconLayersSubtract size={50} />
        </Box>
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Title order={2}>{t("sidemenu.organizing", "Organizing")}</Title>
          <Text c="dimmed" size="sm">
            {getSubtitle()}
          </Text>
        </Stack>
      </Group>

      {/* Tab Navigation */}
      {/* Kept on one row on phones: a wrapped tab leaves the active underline under the first row only */}
      <Tabs
        value={tab}
        onChange={handleTabChange}
        styles={{
          list: { flexWrap: "nowrap" },
          tab: { minWidth: 0 },
          tabLabel: { overflow: "hidden", textOverflow: "ellipsis" },
        }}
      >
        <Tabs.List>
          <Tabs.Tab
            value="duplicates"
            leftSection={isPhone ? undefined : <IconCopy size={18} />}
            rightSection={
              duplicateStats ? (
                <Badge size="sm" variant="light" color="gray">
                  {duplicateStats.pending_duplicates > 0
                    ? duplicateStats.pending_duplicates
                    : duplicateStats.total_duplicates}
                </Badge>
              ) : null
            }
          >
            {t("duplicates.title", "Duplicates")}
          </Tabs.Tab>
          <Tabs.Tab
            value="stacks"
            leftSection={isPhone ? undefined : <IconLayersSubtract size={18} />}
            rightSection={
              stackStats ? (
                <Badge size="sm" variant="light" color="gray">
                  {countListedStacks(stackStats)}
                </Badge>
              ) : null
            }
          >
            {t("stacks.title", "Stacks")}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="duplicates" keepMounted={false}>
          <DuplicatesPageContent />
        </Tabs.Panel>

        <Tabs.Panel value="stacks" keepMounted={false}>
          <StacksPageContent />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
