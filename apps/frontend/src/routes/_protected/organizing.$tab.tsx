/**
 * Unified Stacks & Duplicates page - combines both functionalities with tabs.
 *
 * This page provides a unified interface for:
 * - Duplicates: Finding and removing duplicate photos to save storage space
 * - Stacks: Organizing related photos together (bursts, brackets, manual stacks)
 */
import { Badge, Stack, Tabs } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { IconCopy, IconLayersSubtract } from "@tabler/icons-react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDuplicateStatsQuery } from "../../api_client/duplicates";
import { useStackStatsQuery } from "../../api_client/stacks";
import { countListedStacks } from "../../api_client/stacks/types";
import { PageHeader } from "../../components/PageHeader";
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
      return t("duplicates.subtitle");
    }
    return t("stacks.subtitle");
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
    <>
      <PageHeader icon={IconLayersSubtract} title={t("sidemenu.organizing")} subtitle={getSubtitle()} />
      <Stack gap="lg" px={10} pb={10}>
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
              {t("duplicates.title")}
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
              {t("stacks.title")}
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
    </>
  );
}
