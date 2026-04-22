/**
 * Unified Stacks & Duplicates page - combines both functionalities with tabs.
 *
 * This page provides a unified interface for:
 * - Duplicates: Finding and removing duplicate photos to save storage space
 * - Stacks: Organizing related photos together (RAW+JPEG, bursts, brackets, etc.)
 */
import { Group, Stack, Tabs, Text, Title } from "@mantine/core";
import { IconCopy, IconLayersSubtract } from "@tabler/icons-react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDuplicateStatsQuery } from "../../api_client/duplicates";
import { useStackStatsQuery } from "../../api_client/stacks";
import { DuplicatesPageContent } from "../../components/stacks-duplicates/DuplicatesPageContent";
import { StacksPageContent } from "../../components/stacks-duplicates/StacksPageContent";

type StacksDuplicatesSearchParams = {
  type?: string;
  status?: string;
};

export const Route = createFileRoute("/_protected/organizing/$tab")({
  validateSearch: (search: Record<string, unknown>): StacksDuplicatesSearchParams => ({
    type: search.type as string | undefined,
    status: search.status as string | undefined,
  }),
});

export function StacksDuplicatesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tab } = Route.useParams();
  const { data: duplicateStats } = useDuplicateStatsQuery();
  const { data: stackStats } = useStackStatsQuery();

  // Validate tab parameter
  if (tab !== "duplicates" && tab !== "stacks") {
    return <Navigate to="/organizing/duplicates" replace />;
  }

  const getSubtitle = () => {
    if (tab === "duplicates") {
      return t("duplicates.subtitle", "Find and remove duplicate photos to save storage space");
    }
    return t("stacks.subtitle", "Organize RAW+JPEG pairs, bursts, and related photos");
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
    <Stack gap="lg" p="md">
      {/* Shared Header */}
      <Group>
        <div>
          <Title order={2}>{t("sidemenu.organizing", "Organizing")}</Title>
          <Text c="dimmed" size="sm">
            {getSubtitle()}
          </Text>
        </div>
      </Group>

      {/* Tab Navigation */}
      <Tabs value={tab} onChange={handleTabChange}>
        <Tabs.List>
          <Tabs.Tab
            value="duplicates"
            leftSection={<IconCopy size={18} />}
            rightSection={
              duplicateStats ? (
                <span style={{ marginLeft: 4 }}>
                  (
                  {duplicateStats.pending_duplicates > 0
                    ? duplicateStats.pending_duplicates
                    : duplicateStats.total_duplicates}
                  )
                </span>
              ) : null
            }
          >
            {t("duplicates.title", "Duplicates")}
          </Tabs.Tab>
          <Tabs.Tab
            value="stacks"
            leftSection={<IconLayersSubtract size={18} />}
            rightSection={stackStats ? <span style={{ marginLeft: 4 }}>({stackStats.total_stacks})</span> : null}
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

Route.update({ component: StacksDuplicatesPage });
