/**
 * Duplicates page content - extracted component for use in unified page.
 *
 * This component focuses on storage cleanup by finding and removing duplicate files.
 * Supports both exact copies (identical files) and visual duplicates (similar images).
 */
import { DuplicateType, ReviewStatus, type User } from "@librephotos/api-client";
import { Button, Group, Pagination, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { IconCopy } from "@tabler/icons-react";
import React, { useEffect, useState, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { useAccessToken } from "../../api_client/auth";
import {
  useDeleteDuplicateMutation,
  useDetectDuplicatesMutation,
  useDuplicatesQuery,
  useDuplicateStatsQuery,
} from "../../api_client/duplicates";
import { useFetchUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { ListEmptyState } from "../common/ListEmptyState";
import { PageLoader } from "../common/PageLoader";
import { useListFailure } from "../common/useListFailure";
import { DeleteDuplicatesModal } from "./DeleteDuplicatesModal";
import { DetectDuplicatesMenu } from "./DetectDuplicatesMenu";
import { DuplicateCard } from "./DuplicateCard";
import { DuplicateModal } from "./DuplicateModal";
import { ALL_STATUSES, DuplicatesFilters, type StatusOption } from "./DuplicatesFilters";
import { useStepBackFromMissingPage } from "./useStepBackFromMissingPage";

type DetectOptions = React.ComponentProps<typeof DetectDuplicatesMenu>["detectOptions"];

// Map sensitivity to visual threshold
const sensitivityToThreshold = (sensitivity: string | undefined): number => {
  switch (sensitivity) {
    case "strict":
      return 1;
    case "loose":
      return 5;
    case "normal":
    case undefined:
    default:
      return 3;
  }
};

/** The detection options before any is changed here: the user's duplicate settings. */
const detectDefaults = (user: User | undefined): DetectOptions => ({
  detect_exact_copies: true,
  detect_visual_duplicates: true,
  visual_threshold: sensitivityToThreshold(user?.duplicate_sensitivity),
  clear_pending: user?.duplicate_clear_existing ?? false,
});

/** The ids that `settled` (one result per id, in order) says were deleted. */
const deletedIds = (ids: string[], settled: PromiseSettledResult<unknown>[]) =>
  ids.filter((_, index) => settled[index]?.status === "fulfilled");

export function DuplicatesPageContent() {
  const { t } = useTranslation();
  // Read synchronously (no SSR here) so phones do not paint the desktop layout for a frame
  const isPhone = useMediaQuery("(max-width: 36em)", undefined, { getInitialValueInEffect: false });
  // Get search params from URL
  const urlParams = new URLSearchParams(window.location.search);
  const statusParam = urlParams.get("status");
  const typeParam = urlParams.get("type");

  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id.toString() ?? "");

  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string | null>(null);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | undefined>(
    ReviewStatus.safeParse(statusParam).data ?? "pending"
  );
  const [typeFilter, setTypeFilter] = useState<DuplicateType | undefined>(DuplicateType.safeParse(typeParam).data);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // The options as changed in the menu, over the user's settings until then: a fetch of the
  // settings (window focus) no longer undoes a change.
  const [editedDetectOptions, setEditedDetectOptions] = useState<DetectOptions | null>(null);
  const detectOptions = editedDetectOptions ?? detectDefaults(userSelfDetails);
  const setDetectOptions = (next: SetStateAction<DetectOptions>) =>
    setEditedDetectOptions(edited => {
      const current = edited ?? detectDefaults(userSelfDetails);
      return typeof next === "function" ? next(current) : next;
    });

  // Initialize filters from URL search params
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const statusFromUrl = ReviewStatus.safeParse(searchParams.get("status")).data;
    const typeFromUrl = DuplicateType.safeParse(searchParams.get("type")).data;

    if (typeFromUrl) {
      setTypeFilter(typeFromUrl);
    }
    if (statusFromUrl) {
      setStatusFilter(statusFromUrl);
    }
  }, []);

  const { data: stats } = useDuplicateStatsQuery();
  const duplicatesQuery = useDuplicatesQuery({
    duplicate_type: typeFilter,
    review_status: statusFilter,
    page,
    page_size: pageSize,
  });
  const { data: duplicatesResponse, isLoading: duplicatesLoading, error: duplicatesError } = duplicatesQuery;
  const listFailure = useListFailure(duplicatesQuery);
  useStepBackFromMissingPage(page, setPage, duplicatesError);
  const { mutate: detectDuplicates, isPending: isDetecting } = useDetectDuplicatesMutation();
  const { mutateAsync: deleteDuplicate } = useDeleteDuplicateMutation();

  const duplicates = duplicatesResponse?.results ?? [];
  const totalPages = duplicatesResponse?.num_pages ?? 1;
  const totalCount = duplicatesResponse?.count ?? 0;

  const handleDetect = () => {
    detectDuplicates(detectOptions);
  };

  // Groups waiting for the delete confirmation. Kept after closing so the
  // dialog title does not change while it fades out.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, { open: openDeleteConfirm, close: closeDeleteConfirm }] = useDisclosure(false);

  const askToDelete = (ids: string[]) => {
    setPendingDeleteIds(ids);
    openDeleteConfirm();
  };

  // The dialog waits for every delete; only the groups that are gone leave the selection, so a
  // failed one (toasted by the QueryClient) can be deleted again.
  const confirmDelete = async () => {
    setDeleting(true);
    const settled = await Promise.allSettled(pendingDeleteIds.map(id => deleteDuplicate(id)));
    const deleted = deletedIds(pendingDeleteIds, settled);
    setSelectedDuplicateIds(prev => new Set([...prev].filter(id => !deleted.includes(id))));
    setDeleting(false);
    closeDeleteConfirm();
  };

  // Reset page and selection when a filter changes: Select All and Delete
  // Selected must only ever act on the groups on screen
  React.useEffect(() => {
    setPage(1);
    setSelectedDuplicateIds(new Set());
  }, [statusFilter, typeFilter]);

  const changePage = (newPage: number) => {
    setPage(newPage);
    setSelectedDuplicateIds(new Set());
  };

  const duplicateTypes: Array<{ value: DuplicateType | ""; label: string }> = [
    { value: "", label: t("duplicates.allTypes") },
    ...DuplicateType.options.map(type => ({ value: type, label: t(`duplicates.types.${type}`) })),
  ];

  const statusOptions: StatusOption[] = [
    { value: "pending", label: t("duplicates.pending"), count: stats?.pending_duplicates },
    { value: "resolved", label: t("duplicates.resolved"), count: stats?.resolved_duplicates },
    { value: "dismissed", label: t("duplicates.dismissed"), count: stats?.dismissed_duplicates },
    { value: ALL_STATUSES, label: t("duplicates.all") },
  ];
  // "All" is no status, so it parses to undefined
  const onStatusChange = (value: string | null) => setStatusFilter(ReviewStatus.safeParse(value).data);

  const selectedOnPage = duplicates.filter(d => selectedDuplicateIds.has(d.id)).length;

  const getEmptyDescription = () => {
    if (!stats?.total_duplicates) return t("duplicates.empty");
    if (statusFilter === "pending" && !typeFilter) return t("duplicates.nopending");
    return t("duplicates.nomatch");
  };

  return (
    <Stack gap="lg">
      {/* Bulk Actions Toolbar */}
      {selectedDuplicateIds.size > 0 && (
        <Paper p="md" withBorder bg="var(--mantine-color-blue-light)">
          <Group justify="space-between">
            <Text size="sm" fw={500}>
              {t("duplicates.selectedCount", { count: selectedDuplicateIds.size })}
            </Text>
            <Group>
              <Button variant="light" color="red" size="sm" onClick={() => askToDelete([...selectedDuplicateIds])}>
                {t("duplicates.deleteSelected")}
              </Button>
              <Button variant="light" size="sm" onClick={() => setSelectedDuplicateIds(new Set())}>
                {t("duplicates.clearSelection")}
              </Button>
            </Group>
          </Group>
        </Paper>
      )}

      {/* Filters and Action Buttons */}
      <Group justify="space-between" align="center" mt="md">
        <DuplicatesFilters
          duplicates={duplicates}
          selectedOnPage={selectedOnPage}
          setSelectedDuplicateIds={setSelectedDuplicateIds}
          statusFilter={statusFilter}
          onStatusChange={onStatusChange}
          statusOptions={statusOptions}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          duplicateTypes={duplicateTypes}
        />
        <DetectDuplicatesMenu
          isPhone={isPhone}
          detectOptions={detectOptions}
          setDetectOptions={setDetectOptions}
          onDetect={handleDetect}
          isDetecting={isDetecting}
        />
      </Group>

      {/* Duplicates Grid */}
      {duplicatesLoading ? (
        <PageLoader />
      ) : duplicates && duplicates.length > 0 ? (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
            {duplicates.map(duplicate => (
              <DuplicateCard
                key={duplicate.id}
                duplicate={duplicate}
                onClick={() => setSelectedDuplicateId(duplicate.id)}
                onDelete={() => askToDelete([duplicate.id])}
                isSelected={selectedDuplicateIds.has(duplicate.id)}
                onToggleSelect={() => {
                  const newSet = new Set(selectedDuplicateIds);
                  if (newSet.has(duplicate.id)) {
                    newSet.delete(duplicate.id);
                  } else {
                    newSet.add(duplicate.id);
                  }
                  setSelectedDuplicateIds(newSet);
                }}
              />
            ))}
          </SimpleGrid>
          {totalPages > 1 && (
            <Group justify="center" mt="md" gap="md">
              {totalCount > 0 && (
                <Text size="sm" c="dimmed">
                  {t("duplicates.showing", { count: totalCount })}
                </Text>
              )}
              <Pagination value={page} onChange={changePage} total={totalPages} withEdges />
            </Group>
          )}
        </>
      ) : (
        <ListEmptyState
          failure={listFailure}
          icon={<IconCopy size={40} />}
          title={t("duplicates.noduplicates")}
          description={getEmptyDescription()}
        />
      )}

      {/* Detail Modal */}
      {selectedDuplicateId && (
        <DuplicateModal
          duplicateId={selectedDuplicateId}
          opened={!!selectedDuplicateId}
          onClose={() => setSelectedDuplicateId(null)}
        />
      )}

      <DeleteDuplicatesModal
        opened={deleteConfirmOpen}
        count={pendingDeleteIds.length}
        onClose={closeDeleteConfirm}
        onConfirm={() => void confirmDelete()}
        loading={deleting}
      />
    </Stack>
  );
}
