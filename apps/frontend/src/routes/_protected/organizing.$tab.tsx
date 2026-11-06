/**
 * Unified Stacks & Duplicates page - combines both functionalities with tabs.
 *
 * This page provides a unified interface for:
 * - Duplicates: Finding and removing duplicate photos to save storage space
 * - Stacks: Organizing related photos together (bursts, brackets, manual stacks)
 */
import { countListedStacks } from "@librephotos/api-client";
import { Tabs } from "@mantine/core";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDuplicateStatsQuery } from "../../api_client/duplicates";
import { useStackStatsQuery } from "../../api_client/stacks";
import { PageTabs } from "../../components/common/PageTabs";
import { PageBody } from "../../components/PageBody";
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

  // Validate tab parameter
  if (tab !== "duplicates" && tab !== "stacks") {
    return <Navigate to="/organizing/$tab" params={{ tab: "duplicates" }} replace />;
  }

  // The groups waiting for review, or all of them once none are
  let duplicateCount: number | undefined;
  if (duplicateStats)
    duplicateCount =
      duplicateStats.pending_duplicates > 0 ? duplicateStats.pending_duplicates : duplicateStats.total_duplicates;

  return (
    <>
      <PageHeader
        title={t("sidemenu.organizing")}
        subtitle={tab === "duplicates" ? t("duplicates.subtitle") : t("stacks.subtitle")}
      />
      <PageBody gap="lg">
        <PageTabs
          value={tab}
          onChange={value => void navigate({ to: "/organizing/$tab", params: { tab: value } })}
          tabs={[
            { value: "duplicates", label: t("duplicates.title"), count: duplicateCount },
            {
              value: "stacks",
              label: t("stacks.title"),
              count: stackStats ? countListedStacks(stackStats) : undefined,
            },
          ]}
        >
          <Tabs.Panel value="duplicates">
            <DuplicatesPageContent />
          </Tabs.Panel>

          <Tabs.Panel value="stacks">
            <StacksPageContent />
          </Tabs.Panel>
        </PageTabs>
      </PageBody>
    </>
  );
}
