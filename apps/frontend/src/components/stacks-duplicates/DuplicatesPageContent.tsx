/**
 * Duplicates page content - extracted component for use in unified page.
 *
 * This component focuses on storage cleanup by finding and removing duplicate files.
 * Supports both exact copies (identical files) and visual duplicates (similar images).
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  Divider,
  Group,
  Image,
  Loader,
  Menu,
  Modal,
  Pagination,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import {
  IconArrowBackUp,
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconDots,
  IconMaximize,
  IconPhoto,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { DateTime } from "luxon";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { useAccessToken } from "../../api_client/auth";
import {
  useDeleteDuplicateMutation,
  useDetectDuplicatesMutation,
  useDismissDuplicateMutation,
  useDuplicateQuery,
  useDuplicatesQuery,
  useDuplicateStatsQuery,
  useResolveDuplicateMutation,
  useRevertDuplicateMutation,
} from "../../api_client/duplicates";
import { DuplicateType, ReviewStatus, type Duplicate, type DuplicatePhoto } from "../../api_client/duplicates/types";
import { useFetchUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { buttonRoleProps } from "../../util/a11y";
import { parsePhotoTimestamp } from "../../util/dateUtils";
import { PLACEHOLDER_IMAGE } from "../../util/placeholderImage";
import { EmptyState } from "../common/EmptyState";
import { Lightbox } from "../lightbox";

// Select options cannot be "", so "all statuses" gets a sentinel value
const ALL_STATUSES = "all";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function formatResolution(width: number | null, height: number | null): string | null {
  if (!width || !height) return null;
  return `${width} × ${height}`;
}

function getDuplicateTypeIcon(type: DuplicateType, size = 14) {
  switch (type) {
    case "exact_copy":
      return <IconCopy size={size} />;
    case "visual_duplicate":
      return <IconPhoto size={size} />;
    default:
      return <IconCopy size={size} />;
  }
}

function getDuplicateTypeColor(type: DuplicateType): string {
  switch (type) {
    case "exact_copy":
      return "red";
    case "visual_duplicate":
      return "orange";
    default:
      return "gray";
  }
}

function DuplicatePhotoCard({
  photo,
  isSelected,
  onSelect,
  onViewFull,
  showSelectButton = true,
}: {
  photo: DuplicatePhoto;
  isSelected: boolean;
  onSelect: () => void;
  onViewFull: () => void;
  showSelectButton?: boolean;
}) {
  const { t } = useTranslation();
  const thumbnailUrl = photo.thumbnail_big_url
    ? `${serverAddress}${photo.thumbnail_big_url}`
    : photo.thumbnail_url
      ? `${serverAddress}${photo.thumbnail_url}`
      : undefined;

  return (
    <Card
      shadow="sm"
      padding="sm"
      radius="md"
      withBorder
      style={{
        borderColor: isSelected ? "var(--mantine-color-blue-5)" : undefined,
        borderWidth: isSelected ? 2 : 1,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Card.Section style={{ position: "relative", flexShrink: 0 }}>
        <Box
          style={{
            position: "relative",
            width: "100%",
            height: 200,
            overflow: "hidden",
            backgroundColor: "var(--mantine-color-dark-6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image
            src={thumbnailUrl}
            alt={t("duplicates.photoalt", "Duplicate photo")}
            fallbackSrc={PLACEHOLDER_IMAGE}
            fit="contain"
            h={200}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          />
          {photo.is_kept && (
            <Badge size="xs" color="green" style={{ position: "absolute", top: 4, left: 4 }}>
              {t("duplicates.original", "Original")}
            </Badge>
          )}
        </Box>
        <ActionIcon
          variant="filled"
          color="dark"
          size="sm"
          style={{ position: "absolute", top: 8, right: 8, opacity: 0.8 }}
          aria-label={t("viewfull")}
          onClick={e => {
            e.stopPropagation();
            onViewFull();
          }}
        >
          <IconMaximize size={14} />
        </ActionIcon>
      </Card.Section>

      <Stack gap="xs" mt="sm" style={{ flex: 1 }}>
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            {formatResolution(photo.width, photo.height) ?? t("settings.unknown", "Unknown")}
          </Text>
          <Badge color={photo.size > 1024 * 1024 ? "blue" : "gray"} variant="light">
            {formatFileSize(photo.size)}
          </Badge>
        </Group>

        {photo.camera && (
          <Text size="xs" c="dimmed">
            📷 {photo.camera}
          </Text>
        )}

        {photo.exif_timestamp && (
          <Text size="xs" c="dimmed">
            📅 {parsePhotoTimestamp(photo.exif_timestamp).toLocaleString(DateTime.DATE_SHORT)}
          </Text>
        )}

        {photo.file_path && (
          <Tooltip label={photo.file_path} multiline w={300}>
            <Text size="xs" c="dimmed" lineClamp={1}>
              📁 {photo.file_path.split("/").pop()}
            </Text>
          </Tooltip>
        )}

        {photo.file_type && (
          <Badge size="xs" variant="outline" color="gray">
            {photo.file_type}
          </Badge>
        )}

        {showSelectButton && (
          <Button
            variant={isSelected ? "filled" : "outline"}
            color={isSelected ? "blue" : "gray"}
            leftSection={isSelected ? <IconCheck size={16} /> : null}
            onClick={onSelect}
            fullWidth
            size="sm"
            mt="auto"
          >
            {isSelected ? t("duplicates.selected", "Keep This") : t("duplicates.select", "Select")}
          </Button>
        )}
      </Stack>
    </Card>
  );
}

function DuplicateModal({
  duplicateId,
  opened,
  onClose,
}: {
  duplicateId: string;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [lightboxImageHash, setLightboxImageHash] = useState<string | null>(null);
  const [lightboxOpened, { open: openLightbox, close: closeLightbox }] = useDisclosure(false);

  const { data: duplicate, isLoading } = useDuplicateQuery(duplicateId);
  const { mutate: resolveDuplicate, isPending: isResolving } = useResolveDuplicateMutation();
  const { mutate: dismissDuplicate, isPending: isDismissing } = useDismissDuplicateMutation();
  const { mutate: revertDuplicate, isPending: isReverting } = useRevertDuplicateMutation();

  const isResolved = duplicate?.review_status === "resolved";
  const isDismissed = duplicate?.review_status === "dismissed";
  const isReviewed = isResolved || isDismissed;

  // Create idx2hash array for the Lightbox component
  const idx2hash = React.useMemo(() => {
    if (!duplicate?.photos || duplicate.photos.length === 0) return [];
    return duplicate.photos.map(p => ({ id: p.id, image_hash: p.image_hash }));
  }, [duplicate?.photos]);

  const handleViewFull = (photo: DuplicatePhoto) => {
    setLightboxImageHash(photo.image_hash);
    openLightbox();
  };

  const handleResolve = () => {
    if (selectedPhoto) {
      resolveDuplicate(
        { id: duplicateId, keep_photo_hash: selectedPhoto, trash_others: true },
        {
          onSuccess: () => {
            onClose();
            setSelectedPhoto(null);
          },
        }
      );
    }
  };

  const handleDismiss = () => {
    dismissDuplicate(duplicateId, {
      onSuccess: () => {
        onClose();
        setSelectedPhoto(null);
      },
    });
  };

  const handleRevert = () => {
    revertDuplicate(duplicateId, {
      onSuccess: () => {
        onClose();
        setSelectedPhoto(null);
      },
    });
  };

  // Auto-select highest resolution photo when duplicate loads
  React.useEffect(() => {
    if (duplicate?.photos && duplicate.photos.length > 0 && !selectedPhoto) {
      // First try kept photo
      const kept = duplicate.photos.find(p => p.is_kept);
      if (kept) {
        setSelectedPhoto(kept.image_hash);
        return;
      }
      // Otherwise pick best by resolution then size
      const best = [...duplicate.photos].sort((a, b) => {
        const aRes = (a.width || 0) * (a.height || 0);
        const bRes = (b.width || 0) * (b.height || 0);
        if (aRes !== bRes) return bRes - aRes;
        return b.size - a.size;
      })[0];
      setSelectedPhoto(best.image_hash);
    }
  }, [duplicate, selectedPhoto]);

  const getDuplicateDescription = () => {
    if (!duplicate) return "";
    switch (duplicate.duplicate_type) {
      case "exact_copy":
        return t("duplicates.desc.exact_copy", "These are exact copies of the same file (identical content).");
      case "visual_duplicate":
        return t(
          "duplicates.desc.visual_duplicate",
          "These photos look visually similar but may have different resolutions or quality."
        );
      default:
        return "";
    }
  };

  return (
    <>
      {lightboxOpened && lightboxImageHash && (
        <Lightbox
          isPublic={false}
          idx2hash={idx2hash}
          selectedImage={lightboxImageHash}
          onCloseRequest={closeLightbox}
          onChangedIndex={() => {}}
        />
      )}
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          // A span, not a Group (a div): Mantine's title is an <h2>, which takes phrasing
          // content only. The 18px icon matches the theme's title text.
          <Box
            component="span"
            style={{ display: "inline-flex", alignItems: "center", gap: "var(--mantine-spacing-xs)" }}
          >
            {duplicate && getDuplicateTypeIcon(duplicate.duplicate_type, 18)}
            {/* Plain text, styled by the app's Modal theme */}
            {duplicate ? t(`duplicates.types.${duplicate.duplicate_type}`) : t("duplicates.review", "Review Duplicate")}
          </Box>
        }
        size="90%"
        centered
        styles={{
          body: { maxHeight: "80vh", display: "flex", flexDirection: "column" },
        }}
      >
        {isLoading ? (
          <Stack align="center" p="xl">
            <Loader size="lg" />
            <Text>{t("duplicates.loading", "Loading duplicate...")}</Text>
          </Stack>
        ) : duplicate ? (
          <Stack style={{ flex: 1, minHeight: 0 }}>
            <Text size="sm" c="dimmed">
              {getDuplicateDescription()}
              {/* !! so a score of 0 does not render a stray "0" */}
              {!!duplicate.similarity_score && (
                <Text span size="sm" c="blue" ml="xs">
                  {t("duplicates.similarpercent", "({{percent}}% similar)", {
                    percent: Math.round(duplicate.similarity_score * 100),
                  })}
                </Text>
              )}
            </Text>

            {!isReviewed && (
              <Text size="sm" c="dimmed">
                {t("duplicates.selectbest", "Select the photo you want to keep. Others will be moved to trash.")}
              </Text>
            )}

            {isResolved && (
              <Text size="sm" c="dimmed">
                {t("duplicates.resolvedInfo", "This duplicate was resolved. Some photos were moved to trash.")}{" "}
                <Text span size="sm" c="blue">
                  {t("duplicates.revertInfo", "You can revert to restore trashed photos.")}
                </Text>
              </Text>
            )}

            {/* Dismissing unlinks the photos and the backend only reverts resolved groups, so no revert here */}
            {isDismissed && (
              <Text size="sm" c="dimmed">
                {t("duplicates.dismissedInfo", "This was marked as not a duplicate.")}
              </Text>
            )}

            <ScrollArea style={{ flex: 1 }} offsetScrollbars>
              <SimpleGrid cols={{ base: 1, sm: 2, md: duplicate.photos.length > 2 ? 3 : 2 }} spacing="md" p="xs">
                {duplicate.photos.map(photo => (
                  <DuplicatePhotoCard
                    key={photo.image_hash}
                    photo={photo}
                    isSelected={selectedPhoto === photo.image_hash}
                    onSelect={() => setSelectedPhoto(photo.image_hash)}
                    onViewFull={() => handleViewFull(photo)}
                    showSelectButton={!isReviewed}
                  />
                ))}
              </SimpleGrid>
            </ScrollArea>

            <Divider my="md" />

            {isReviewed ? (
              <Group justify="flex-end">
                <Button variant="outline" onClick={onClose}>
                  {t("close", "Close")}
                </Button>
                {isResolved && (
                  <Button
                    color="blue"
                    leftSection={<IconArrowBackUp size={16} />}
                    onClick={handleRevert}
                    loading={isReverting}
                  >
                    {t("duplicates.revert", "Revert & Restore Photos")}
                  </Button>
                )}
              </Group>
            ) : (
              <Group justify="space-between">
                <Button
                  variant="subtle"
                  color="gray"
                  leftSection={<IconX size={16} />}
                  onClick={handleDismiss}
                  loading={isDismissing}
                >
                  {t("duplicates.notduplicates", "Not Duplicates")}
                </Button>

                <Group>
                  <Button variant="outline" onClick={onClose}>
                    {t("cancel", "Cancel")}
                  </Button>
                  <Button
                    color="blue"
                    leftSection={<IconCheck size={16} />}
                    onClick={handleResolve}
                    loading={isResolving}
                    disabled={!selectedPhoto}
                  >
                    {t("duplicates.keepandtrash", "Keep Selected & Trash Others")}
                  </Button>
                </Group>
              </Group>
            )}
          </Stack>
        ) : (
          <Text c="red">{t("duplicates.error", "Failed to load duplicate")}</Text>
        )}
      </Modal>
    </>
  );
}

function DuplicateCard({
  duplicate,
  onClick,
  onDelete,
  isSelected = false,
  onToggleSelect,
}: {
  duplicate: Duplicate;
  onClick: () => void;
  onDelete: () => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { t } = useTranslation();
  const isResolved = duplicate.review_status === "resolved";
  const isDismissed = duplicate.review_status === "dismissed";
  const isPending = duplicate.review_status === "pending";
  const typeColor = getDuplicateTypeColor(duplicate.duplicate_type);

  return (
    <Card
      padding={0}
      radius="md"
      withBorder
      style={{
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        borderColor: isSelected ? "var(--mantine-color-blue-5)" : undefined,
        borderWidth: isSelected ? 2 : 1,
      }}
    >
      {/* Selection checkbox */}
      {onToggleSelect && (
        <Checkbox
          checked={isSelected}
          onChange={e => {
            e.stopPropagation();
            onToggleSelect();
          }}
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 10,
            backgroundColor: "rgba(255, 255, 255, 0.9)",
            borderRadius: "4px",
            padding: "2px",
          }}
        />
      )}
      {/* Image Preview */}
      <Group gap={1} wrap="nowrap" aria-label={t("duplicates.reviewgroup")} {...buttonRoleProps(onClick)}>
        {duplicate.preview_photos.slice(0, 2).map((photo, index) => (
          <Image
            key={photo.image_hash || index}
            src={photo.thumbnail_url ? `${serverAddress}${photo.thumbnail_url}` : undefined}
            h={100}
            w="50%"
            // Decorative: the surrounding button is named by its aria-label
            alt=""
            fallbackSrc={PLACEHOLDER_IMAGE}
            style={{
              opacity: isResolved || isDismissed ? 0.6 : 1,
            }}
          />
        ))}
      </Group>

      {/* Footer with badges */}
      <Group gap="xs" p="xs" onClick={onClick}>
        <Badge size="sm" variant="light" color={typeColor} leftSection={getDuplicateTypeIcon(duplicate.duplicate_type)}>
          {duplicate.photo_count}
        </Badge>
        <Badge size="sm" variant="light" color={isPending ? "yellow" : isResolved ? "green" : "gray"}>
          {t(`duplicates.${duplicate.review_status}`)}
        </Badge>
        {duplicate.potential_savings > 1024 * 1024 && (
          <Tooltip label={t("duplicates.potentialSavings", "Potential space savings")}>
            <Badge size="sm" variant="outline" color="red">
              {formatFileSize(duplicate.potential_savings)}
            </Badge>
          </Tooltip>
        )}
      </Group>

      {/* Context Menu */}
      <Menu shadow="md" width={180} position="bottom-end">
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              background: "rgba(0,0,0,0.5)",
              borderRadius: "4px",
            }}
            aria-label={t("moreactions")}
            onClick={e => e.stopPropagation()}
          >
            <IconDots size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconTrash size={14} />}
            color="red"
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
          >
            {t("duplicates.deleteGroup", "Delete Group")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Card>
  );
}

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

  // Map sensitivity to visual threshold
  const sensitivityToThreshold = (sensitivity: string | undefined): number => {
    switch (sensitivity) {
      case "strict":
        return 1;
      case "loose":
        return 5;
      case "normal":
      default:
        return 3;
    }
  };

  // Detection options - initialized from user settings
  const [detectOptions, setDetectOptions] = useState({
    detect_exact_copies: true,
    detect_visual_duplicates: true,
    visual_threshold: sensitivityToThreshold(userSelfDetails?.duplicate_sensitivity),
    clear_pending: userSelfDetails?.duplicate_clear_existing ?? false,
  });

  // Update detection options when user settings load
  useEffect(() => {
    if (userSelfDetails) {
      setDetectOptions(prev => ({
        ...prev,
        visual_threshold: sensitivityToThreshold(userSelfDetails.duplicate_sensitivity),
        clear_pending: userSelfDetails.duplicate_clear_existing ?? false,
      }));
    }
  }, [userSelfDetails]);

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
  const { data: duplicatesResponse, isLoading: duplicatesLoading } = useDuplicatesQuery({
    duplicate_type: typeFilter,
    review_status: statusFilter,
    page,
    page_size: pageSize,
  });
  const { mutate: detectDuplicates, isPending: isDetecting } = useDetectDuplicatesMutation();
  const { mutate: deleteDuplicate } = useDeleteDuplicateMutation();

  const duplicates = duplicatesResponse?.results ?? [];
  const totalPages = duplicatesResponse?.num_pages ?? 1;
  const totalCount = duplicatesResponse?.count ?? 0;

  const handleDetect = () => {
    detectDuplicates(detectOptions);
  };

  // Groups waiting for the delete confirmation. Kept after closing so the
  // dialog title does not change while it fades out.
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const askToDelete = (ids: string[]) => {
    setPendingDeleteIds(ids);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    pendingDeleteIds.forEach(id => deleteDuplicate(id));
    setSelectedDuplicateIds(prev => new Set([...prev].filter(id => !pendingDeleteIds.includes(id))));
    setDeleteConfirmOpen(false);
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
    { value: "", label: t("duplicates.allTypes", "All Types") },
    ...DuplicateType.options.map(type => ({ value: type, label: t(`duplicates.types.${type}`) })),
  ];

  const statusOptions = [
    { value: "pending", label: `${t("duplicates.pending", "Pending")} (${stats?.pending_duplicates ?? 0})` },
    { value: "resolved", label: `${t("duplicates.resolved", "Resolved")} (${stats?.resolved_duplicates ?? 0})` },
    { value: "dismissed", label: `${t("duplicates.dismissed", "Dismissed")} (${stats?.dismissed_duplicates ?? 0})` },
    { value: ALL_STATUSES, label: t("duplicates.all", "All") },
  ];
  // "All" is no status, so it parses to undefined
  const onStatusChange = (value: string | null) => setStatusFilter(ReviewStatus.safeParse(value).data);

  const selectedOnPage = duplicates.filter(d => selectedDuplicateIds.has(d.id)).length;

  const getEmptyDescription = () => {
    if (!stats?.total_duplicates) return t("duplicates.empty");
    if (statusFilter === "pending" && !typeFilter) return t("duplicates.nopending");
    return t("duplicates.nomatch", "No duplicate groups match the current filters.");
  };

  return (
    <Stack gap="lg">
      {/* Bulk Actions Toolbar */}
      {selectedDuplicateIds.size > 0 && (
        <Paper p="md" withBorder bg="var(--mantine-color-blue-light)">
          <Group justify="space-between">
            <Text size="sm" fw={500}>
              {t("duplicates.selectedCount", "{{count}} selected", { count: selectedDuplicateIds.size })}
            </Text>
            <Group>
              <Button variant="light" color="red" size="sm" onClick={() => askToDelete([...selectedDuplicateIds])}>
                {t("duplicates.deleteSelected", "Delete Selected")}
              </Button>
              <Button variant="light" size="sm" onClick={() => setSelectedDuplicateIds(new Set())}>
                {t("duplicates.clearSelection", "Clear Selection")}
              </Button>
            </Group>
          </Group>
        </Paper>
      )}

      {/* Filters and Action Buttons */}
      <Group justify="space-between" align="center" mt="md">
        <Group>
          {/* Bulk selection checkbox */}
          {duplicates.length > 0 && (
            <Checkbox
              checked={selectedOnPage === duplicates.length}
              indeterminate={selectedOnPage > 0 && selectedOnPage < duplicates.length}
              onChange={e => {
                if (e.currentTarget.checked) {
                  setSelectedDuplicateIds(new Set(duplicates.map(d => d.id)));
                } else {
                  setSelectedDuplicateIds(new Set());
                }
              }}
              label={t("duplicates.selectAll", "Select All")}
            />
          )}
          {/* Status filter: the segmented control cannot wrap, so phones get a select */}
          <SegmentedControl
            visibleFrom="sm"
            size="sm"
            value={statusFilter ?? ALL_STATUSES}
            onChange={onStatusChange}
            data={statusOptions}
          />
          <Select
            hiddenFrom="sm"
            size="sm"
            w={200}
            aria-label={t("duplicates.statusfilter", "Review status")}
            value={statusFilter ?? ALL_STATUSES}
            onChange={onStatusChange}
            data={statusOptions}
            allowDeselect={false}
          />
          {/* Type filter */}
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <Button variant="light" size="sm" rightSection={<IconChevronDown size={14} />}>
                {typeFilter ? t(`duplicates.types.${typeFilter}`) : t("duplicates.allTypes", "All Types")}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {duplicateTypes.map(type => (
                <Menu.Item
                  key={type.value}
                  onClick={() => setTypeFilter(type.value || undefined)}
                  rightSection={
                    typeFilter === type.value || (!typeFilter && !type.value) ? <IconCheck size={14} /> : null
                  }
                >
                  {type.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
        {/* Stacked on phones: side by side the two buttons are wider than the screen */}
        <Group gap="xs" w={isPhone ? "100%" : undefined}>
          <ButtonGroup orientation={isPhone ? "vertical" : "horizontal"} w={isPhone ? "100%" : undefined}>
            <Menu shadow="md" width={300}>
              <Menu.Target>
                <Button variant="outline" size="sm" fullWidth={isPhone} rightSection={<IconChevronDown size={14} />}>
                  {t("duplicates.detectOptions", "Detection Options")}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{t("duplicates.whatToDetect", "What to Detect")}</Menu.Label>
                <Box px="xs" py={4}>
                  <Stack gap="xs">
                    <Checkbox
                      size="sm"
                      checked={detectOptions.detect_exact_copies}
                      onChange={e => setDetectOptions(o => ({ ...o, detect_exact_copies: e.currentTarget.checked }))}
                      label={t("duplicates.detectExactCopies", "Exact file copies (identical content)")}
                    />
                    <Checkbox
                      size="sm"
                      checked={detectOptions.detect_visual_duplicates}
                      onChange={e =>
                        setDetectOptions(o => ({ ...o, detect_visual_duplicates: e.currentTarget.checked }))
                      }
                      label={t("duplicates.detectVisualDuplicates", "Visual duplicates (similar images)")}
                    />
                    {detectOptions.detect_visual_duplicates && (
                      <Box pl="md">
                        <Text size="xs" c="dimmed" mb={4}>
                          {t("duplicates.visualSensitivity", "Visual sensitivity")}
                        </Text>
                        <SegmentedControl
                          size="xs"
                          value={
                            detectOptions.visual_threshold === 1
                              ? "strict"
                              : detectOptions.visual_threshold === 5
                                ? "loose"
                                : "normal"
                          }
                          onChange={v =>
                            setDetectOptions(o => ({
                              ...o,
                              visual_threshold: v === "strict" ? 1 : v === "loose" ? 5 : 3,
                            }))
                          }
                          data={[
                            { value: "strict", label: t("settings.sensitivity.strict", "Strict") },
                            { value: "normal", label: t("settings.sensitivity.normal", "Normal") },
                            { value: "loose", label: t("settings.sensitivity.loose", "Loose") },
                          ]}
                        />
                      </Box>
                    )}
                  </Stack>
                </Box>
                <Menu.Divider />
                <Menu.Label>{t("duplicates.optionslabel", "Options")}</Menu.Label>
                <Box px="xs" py={4}>
                  <Checkbox
                    size="sm"
                    checked={detectOptions.clear_pending}
                    onChange={e => setDetectOptions(o => ({ ...o, clear_pending: e.currentTarget.checked }))}
                    label={
                      <Stack gap={0}>
                        <Text size="sm">{t("duplicates.clearPending", "Clear pending duplicates")}</Text>
                        <Text size="xs" c="dimmed">
                          {t("duplicates.clearPendingDesc", "Remove pending duplicates before detection")}
                        </Text>
                      </Stack>
                    }
                  />
                </Box>
              </Menu.Dropdown>
            </Menu>
            <Button
              size="sm"
              fullWidth={isPhone}
              leftSection={<IconRefresh size={16} />}
              onClick={handleDetect}
              loading={isDetecting}
            >
              {t("duplicates.detect")}
            </Button>
          </ButtonGroup>
        </Group>
      </Group>

      {/* Duplicates Grid */}
      {duplicatesLoading ? (
        <Stack align="center" p="xl">
          <Loader size="lg" />
        </Stack>
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
                  {t("duplicates.showing", "Showing {{count}} duplicate groups", { count: totalCount })}
                </Text>
              )}
              <Pagination value={page} onChange={changePage} total={totalPages} withEdges />
            </Group>
          )}
        </>
      ) : (
        <EmptyState
          icon={<IconCopy size={40} />}
          title={t("duplicates.noduplicates", "No duplicate groups found")}
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

      {/* Removing a group cannot be undone, and for a resolved one it also drops the Revert history */}
      <Modal
        opened={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        title={t("duplicates.deleteconfirmtitle", { count: pendingDeleteIds.length })}
        centered
      >
        <Stack>
          <Text size="sm">{t("duplicates.deleteconfirmdescription")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteConfirmOpen(false)}>
              {t("cancel")}
            </Button>
            <Button color="red" onClick={confirmDelete}>
              {t("delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
