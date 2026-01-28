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
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
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
import type { Duplicate, DuplicatePhoto, DuplicateType, ReviewStatus } from "../../api_client/duplicates/types";
import { duplicateTypeLabels } from "../../api_client/duplicates/types";
import { useFetchUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { Lightbox } from "../lightbox";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
}

function formatResolution(width: number | null, height: number | null): string {
  if (!width || !height) return "Unknown";
  return `${width} × ${height}`;
}

function getDuplicateTypeIcon(type: DuplicateType) {
  switch (type) {
    case "exact_copy":
      return <IconCopy size={14} />;
    case "visual_duplicate":
      return <IconPhoto size={14} />;
    default:
      return <IconCopy size={14} />;
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
            alt="Duplicate photo"
            fallbackSrc="https://placehold.co/200x200?text=No+Preview"
            fit="contain"
            h={200}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          />
          {photo.is_kept && (
            <Badge size="xs" color="green" style={{ position: "absolute", top: 4, left: 4 }}>
              Original
            </Badge>
          )}
        </Box>
        <ActionIcon
          variant="filled"
          color="dark"
          size="sm"
          style={{ position: "absolute", top: 8, right: 8, opacity: 0.8 }}
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
            {formatResolution(photo.width, photo.height)}
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
            📅 {new Date(photo.exif_timestamp).toLocaleDateString()}
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
          <Group>
            {duplicate && getDuplicateTypeIcon(duplicate.duplicate_type)}
            <Title order={4}>{duplicate?.duplicate_type_display || t("duplicates.review", "Review Duplicate")}</Title>
          </Group>
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
              {duplicate.similarity_score && (
                <Text span size="sm" c="blue" ml="xs">
                  ({Math.round(duplicate.similarity_score * 100)}% similar)
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

            {isDismissed && (
              <Text size="sm" c="dimmed">
                {t("duplicates.dismissedInfo", "This was marked as not a duplicate.")}{" "}
                <Text span size="sm" c="blue">
                  {t("duplicates.revertInfo", "You can revert to reconsider.")}
                </Text>
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
                <Button
                  color="blue"
                  leftSection={<IconArrowBackUp size={16} />}
                  onClick={handleRevert}
                  loading={isReverting}
                >
                  {t("duplicates.revert", "Revert & Restore Photos")}
                </Button>
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
                  {t("duplicates.notduplicate", "Not a Duplicate")}
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
      <Group gap={1} wrap="nowrap" onClick={onClick}>
        {duplicate.preview_photos.slice(0, 2).map((photo, index) => (
          <Image
            key={photo.image_hash || index}
            src={photo.thumbnail_url ? `${serverAddress}${photo.thumbnail_url}` : undefined}
            h={100}
            w="50%"
            alt="Preview"
            fallbackSrc="https://placehold.co/100x100?text=?"
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
          {duplicate.review_status_display}
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
  // Get search params from URL
  const urlParams = new URLSearchParams(window.location.search);
  const statusParam = urlParams.get("status");
  const typeParam = urlParams.get("type");

  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id.toString() ?? "");

  const [selectedDuplicateId, setSelectedDuplicateId] = useState<string | null>(null);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | undefined>(
    statusParam === "pending" || statusParam === "resolved" || statusParam === "dismissed"
      ? (statusParam as ReviewStatus)
      : "pending"
  );
  const [typeFilter, setTypeFilter] = useState<DuplicateType | undefined>(
    typeParam && (typeParam === "exact_copy" || typeParam === "visual_duplicate")
      ? (typeParam as DuplicateType)
      : undefined
  );
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
    const statusFromUrl = searchParams.get("status");
    const typeFromUrl = searchParams.get("type");

    if (typeFromUrl && (typeFromUrl === "exact_copy" || typeFromUrl === "visual_duplicate")) {
      setTypeFilter(typeFromUrl as DuplicateType);
    }
    if (
      statusFromUrl &&
      (statusFromUrl === "pending" || statusFromUrl === "resolved" || statusFromUrl === "dismissed")
    ) {
      setStatusFilter(statusFromUrl as ReviewStatus);
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

  const handleDeleteDuplicate = (id: string) => {
    deleteDuplicate(id);
  };

  // Reset page when filter changes
  React.useEffect(() => {
    setPage(1);
  }, [statusFilter, typeFilter]);

  const duplicateTypes: Array<{ value: string; label: string }> = [
    { value: "", label: t("duplicates.allTypes", "All Types") },
    { value: "exact_copy", label: duplicateTypeLabels.exact_copy },
    { value: "visual_duplicate", label: duplicateTypeLabels.visual_duplicate },
  ];

  return (
    <Stack gap="lg">
      {/* Bulk Actions Toolbar */}
      {selectedDuplicateIds.size > 0 && (
        <Paper p="md" withBorder bg="blue.0">
          <Group justify="space-between">
            <Text size="sm" fw={500}>
              {t("duplicates.selectedCount", "{{count}} selected", { count: selectedDuplicateIds.size })}
            </Text>
            <Group>
              <Button
                variant="light"
                color="red"
                size="sm"
                onClick={() => {
                  selectedDuplicateIds.forEach(id => handleDeleteDuplicate(id));
                  setSelectedDuplicateIds(new Set());
                }}
              >
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
          <Checkbox
            checked={selectedDuplicateIds.size > 0 && selectedDuplicateIds.size === duplicates.length}
            indeterminate={selectedDuplicateIds.size > 0 && selectedDuplicateIds.size < duplicates.length}
            onChange={e => {
              if (e.currentTarget.checked) {
                setSelectedDuplicateIds(new Set(duplicates.map(d => d.id)));
              } else {
                setSelectedDuplicateIds(new Set());
              }
            }}
            label={t("duplicates.selectAll", "Select All")}
          />
          {/* Status filter */}
          <SegmentedControl
            size="sm"
            value={statusFilter || ""}
            onChange={v => setStatusFilter((v || undefined) as ReviewStatus | undefined)}
            data={[
              { value: "pending", label: `${t("duplicates.pending", "Pending")} (${stats?.pending_duplicates ?? 0})` },
              {
                value: "resolved",
                label: `${t("duplicates.resolved", "Resolved")} (${stats?.resolved_duplicates ?? 0})`,
              },
              {
                value: "dismissed",
                label: `${t("duplicates.dismissed", "Dismissed")} (${stats?.dismissed_duplicates ?? 0})`,
              },
              { value: "", label: t("duplicates.all", "All") },
            ]}
          />
          {/* Type filter */}
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <Button variant="light" size="sm" rightSection={<IconChevronDown size={14} />}>
                {typeFilter ? duplicateTypeLabels[typeFilter] : t("duplicates.allTypes", "All Types")}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {duplicateTypes.map(type => (
                <Menu.Item
                  key={type.value}
                  onClick={() => setTypeFilter((type.value || undefined) as DuplicateType | undefined)}
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
        <Group gap="xs">
          <ButtonGroup>
            <Menu shadow="md" width={300}>
              <Menu.Target>
                <Button variant="outline" size="sm" rightSection={<IconChevronDown size={14} />}>
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
            <Button size="sm" leftSection={<IconRefresh size={16} />} onClick={handleDetect} loading={isDetecting}>
              {t("duplicates.detect", "Find Duplicates")}
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
                onDelete={() => handleDeleteDuplicate(duplicate.id)}
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
              <Pagination value={page} onChange={setPage} total={totalPages} withEdges />
            </Group>
          )}
        </>
      ) : (
        <Paper p="xl" withBorder>
          <Stack align="center" gap="md">
            <IconCopy size={48} color="gray" />
            <Text size="lg" fw={500}>
              {t("duplicates.noDuplicates", "No duplicates found")}
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              {statusFilter === "pending"
                ? t(
                    "duplicates.noPending",
                    "All duplicates have been reviewed. Click 'Find Duplicates' to scan for more."
                  )
                : t("duplicates.empty", "Click 'Find Duplicates' to search for duplicate photos in your library.")}
            </Text>
          </Stack>
        </Paper>
      )}

      {/* Detail Modal */}
      {selectedDuplicateId && (
        <DuplicateModal
          duplicateId={selectedDuplicateId}
          opened={!!selectedDuplicateId}
          onClose={() => setSelectedDuplicateId(null)}
        />
      )}
    </Stack>
  );
}
