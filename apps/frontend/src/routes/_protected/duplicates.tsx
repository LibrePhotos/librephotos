import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Container,
  Divider,
  Group,
  Image,
  Loader,
  Menu,
  Modal,
  Pagination,
  Paper,
  ScrollArea,
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
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import {
  useDeleteDuplicateGroupMutation,
  useDetectDuplicatesMutation,
  useDismissDuplicateGroupMutation,
  useFetchDuplicateGroupQuery,
  useFetchDuplicateGroupsQuery,
  useFetchDuplicateStatsQuery,
  useResolveDuplicateGroupMutation,
  useRevertDuplicateGroupMutation,
} from "../../api_client/duplicates";
import type { DuplicateGroupListItem, DuplicatePhoto, DuplicateSensitivity } from "../../api_client/duplicates/types";
import { Lightbox } from "../../components/lightbox";

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
  const thumbnailUrl = photo.big_thumbnail_url
    ? `${serverAddress}${photo.big_thumbnail_url}`
    : photo.square_thumbnail_url
      ? `${serverAddress}${photo.square_thumbnail_url}`
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

        {photo.image_path && photo.image_path.length > 0 && (
          <Tooltip label={photo.image_path[0]} multiline w={300}>
            <Text size="xs" c="dimmed" lineClamp={1}>
              📁 {photo.image_path[0].split("/").pop()}
            </Text>
          </Tooltip>
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

function DuplicateGroupModal({ groupId, opened, onClose }: { groupId: number; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [lightboxImageHash, setLightboxImageHash] = useState<string | null>(null);
  const [lightboxOpened, { open: openLightbox, close: closeLightbox }] = useDisclosure(false);

  const { data: group, isLoading } = useFetchDuplicateGroupQuery(groupId);
  const { mutate: resolveGroup, isPending: isResolving } = useResolveDuplicateGroupMutation();
  const { mutate: dismissGroup, isPending: isDismissing } = useDismissDuplicateGroupMutation();
  const { mutate: revertGroup, isPending: isReverting } = useRevertDuplicateGroupMutation();

  const isReviewed = group?.status === "reviewed";

  // Create idx2hash array for the Lightbox component
  const idx2hash = React.useMemo(() => {
    if (!group?.photos || group.photos.length === 0) return [];
    return group.photos.map(p => ({ id: p.image_hash }));
  }, [group?.photos]);

  const handleViewFull = (photo: DuplicatePhoto) => {
    setLightboxImageHash(photo.image_hash);
    openLightbox();
  };

  // Handle image change in lightbox (for when user navigates)
  const handleLightboxImageChange = React.useCallback((newImageHash: string) => {
    setLightboxImageHash(newImageHash);
  }, []);

  const handleResolve = () => {
    if (selectedPhoto) {
      resolveGroup(
        { groupId, data: { keep_photo_hash: selectedPhoto, trash_others: true } },
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
    dismissGroup(groupId, {
      onSuccess: () => {
        onClose();
        setSelectedPhoto(null);
      },
    });
  };

  const handleRevert = () => {
    revertGroup(groupId, {
      onSuccess: () => {
        onClose();
        setSelectedPhoto(null);
      },
    });
  };

  // Auto-select highest resolution photo when group loads
  React.useEffect(() => {
    if (group?.photos && group.photos.length > 0 && !selectedPhoto) {
      const best = [...group.photos].sort((a, b) => {
        const aRes = (a.width || 0) * (a.height || 0);
        const bRes = (b.width || 0) * (b.height || 0);
        if (aRes !== bRes) return bRes - aRes;
        return b.size - a.size;
      })[0];
      setSelectedPhoto(best.image_hash);
    }
  }, [group, selectedPhoto]);

  return (
    <>
      {lightboxOpened && lightboxImageHash && (
        <Lightbox
          isPublic={false}
          idx2hash={idx2hash}
          selectedImage={lightboxImageHash}
          onCloseRequest={closeLightbox}
          onChangedIndex={() => {}}
          onImageChange={handleLightboxImageChange}
        />
      )}
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          <Group>
            <IconCopy size={24} />
            <Title order={4}>{t("duplicates.reviewgroup", "Review Duplicate Group")}</Title>
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
            <Text>{t("duplicates.loading", "Loading duplicates...")}</Text>
          </Stack>
        ) : group ? (
          <Stack style={{ flex: 1, minHeight: 0 }}>
            {isReviewed ? (
              <Text size="sm" c="dimmed">
                {t("duplicates.reviewedInfo", "This group was already reviewed. Some photos may be in trash.")}{" "}
                <Text span size="sm" c="blue">
                  {t("duplicates.revertInfo", "You can revert to restore trashed photos.")}
                </Text>
              </Text>
            ) : (
              <Text size="sm" c="dimmed">
                {t("duplicates.selectbest", "Select the photo you want to keep. Others will be moved to trash.")}{" "}
                <Text span size="sm" c="blue">
                  Click the expand icon to view full size.
                </Text>
              </Text>
            )}

            <ScrollArea style={{ flex: 1 }} offsetScrollbars>
              <SimpleGrid cols={{ base: 1, sm: 2, md: group.photos.length > 2 ? 3 : 2 }} spacing="md" p="xs">
                {group.photos.map(photo => (
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
          <Text c="red">{t("duplicates.error", "Failed to load duplicate group")}</Text>
        )}
      </Modal>
    </>
  );
}

function DuplicateGroupCard({
  group,
  onClick,
  onDelete,
}: {
  group: DuplicateGroupListItem;
  onClick: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const isReviewed = group.status === "reviewed";
  const isPending = group.status === "pending";

  return (
    <Card
      padding={0}
      radius="md"
      withBorder
      style={{
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Image Pair */}
      <Group gap={1} wrap="nowrap" onClick={onClick}>
        {group.preview_photos.slice(0, 2).map((photo, index) => (
          <Image
            key={photo.image_hash || index}
            src={photo.square_thumbnail_url ? `${serverAddress}${photo.square_thumbnail_url}` : undefined}
            h={100}
            w="50%"
            alt="Preview"
            fallbackSrc="https://placehold.co/100x100?text=?"
            style={{
              opacity: isReviewed ? 0.6 : 1,
            }}
          />
        ))}
      </Group>

      {/* Footer with badges */}
      <Group gap="xs" p="xs" onClick={onClick}>
        <Badge size="sm" variant="light" color="blue">
          {group.photo_count} {t("duplicates.photos", "photos")}
        </Badge>
        <Badge size="sm" variant="light" color={isPending ? "yellow" : isReviewed ? "green" : "gray"}>
          {isPending ? t("duplicates.pendingReview", "Pending Review") : t("duplicates.reviewed", "Reviewed")}
        </Badge>
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

function DuplicatesPage() {
  const { t } = useTranslation();
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | undefined>("pending");
  const [page, setPage] = useState(1);
  const [sensitivity, setSensitivity] = useState<DuplicateSensitivity>("normal");
  const [reanalyzeAll, setReanalyzeAll] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const pageSize = 20;

  const { data: stats } = useFetchDuplicateStatsQuery();
  const { data: groupsResponse, isLoading: groupsLoading } = useFetchDuplicateGroupsQuery(statusFilter, page, pageSize);
  const { mutate: detectDuplicates, isPending: isDetecting } = useDetectDuplicatesMutation();
  const { mutate: deleteGroup } = useDeleteDuplicateGroupMutation();

  const groups = groupsResponse?.results ?? [];
  const totalPages = groupsResponse?.num_pages ?? 1;
  const totalCount = groupsResponse?.count ?? 0;

  // Load saved settings from stats response
  React.useEffect(() => {
    if (stats && !settingsLoaded) {
      if (stats.saved_sensitivity) {
        setSensitivity(stats.saved_sensitivity);
      }
      if (stats.saved_clear_existing !== undefined) {
        setReanalyzeAll(stats.saved_clear_existing);
      }
      setSettingsLoaded(true);
    }
  }, [stats, settingsLoaded]);

  const handleDetect = () => {
    detectDuplicates({ sensitivity, clearExisting: reanalyzeAll });
  };

  const handleDeleteGroup = (groupId: number) => {
    deleteGroup(groupId);
  };

  // Reset page when filter changes
  React.useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  const sensitivityLabels: Record<DuplicateSensitivity, { label: string; description: string }> = {
    strict: {
      label: t("duplicates.sensitivity.strict", "Strict"),
      description: t("duplicates.sensitivity.strictDesc", "Only exact duplicates (same image, different compression)"),
    },
    normal: {
      label: t("duplicates.sensitivity.normal", "Normal"),
      description: t("duplicates.sensitivity.normalDesc", "Similar images with minor differences"),
    },
    loose: {
      label: t("duplicates.sensitivity.loose", "Loose"),
      description: t("duplicates.sensitivity.looseDesc", "Catches more duplicates including crops and edits"),
    },
  };

  return (
    <Container size="xl" py="md">
      <Stack gap="lg">
        {/* Header */}
        <Group justify="space-between">
          <Group>
            <IconCopy size={32} />
            <Title order={2}>{t("duplicates.title", "Duplicate Photos")}</Title>
          </Group>
          <Group>
            <Menu shadow="md" width={250}>
              <Menu.Target>
                <Button variant="outline" rightSection={<IconChevronDown size={16} />}>
                  {sensitivityLabels[sensitivity].label}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{t("duplicates.sensitivity.title", "Detection Sensitivity")}</Menu.Label>
                {(["strict", "normal", "loose"] as DuplicateSensitivity[]).map(s => (
                  <Menu.Item
                    key={s}
                    onClick={() => setSensitivity(s)}
                    rightSection={sensitivity === s ? <IconCheck size={14} /> : null}
                  >
                    <Stack gap={0}>
                      <Text size="sm" fw={500}>
                        {sensitivityLabels[s].label}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {sensitivityLabels[s].description}
                      </Text>
                    </Stack>
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Label>{t("duplicates.options", "Options")}</Menu.Label>
                <Box px="xs" py={4}>
                  <Checkbox
                    size="sm"
                    checked={reanalyzeAll}
                    onChange={e => setReanalyzeAll(e.currentTarget.checked)}
                    label={
                      <Stack gap={0}>
                        <Text size="sm">{t("duplicates.reanalyze", "Re-analyze all photos")}</Text>
                        <Text size="xs" c="dimmed">
                          {t("duplicates.reanalyzeDesc", "Clear pending groups and detect again")}
                        </Text>
                      </Stack>
                    }
                  />
                </Box>
              </Menu.Dropdown>
            </Menu>
            <Button leftSection={<IconRefresh size={16} />} onClick={handleDetect} loading={isDetecting}>
              {t("duplicates.detect", "Detect Duplicates")}
            </Button>
          </Group>
        </Group>

        {/* Filter */}
        <Group justify="space-between">
          <Group>
            <Tooltip
              label={t("duplicates.pendingTooltip", "{{count}} groups waiting for review", {
                count: stats?.pending_groups ?? 0,
              })}
            >
              <Button
                variant={statusFilter === "pending" ? "filled" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("pending")}
              >
                {t("duplicates.pendingReview", "Pending Review")}{" "}
                {stats?.pending_groups ? `(${stats.pending_groups})` : ""}
              </Button>
            </Tooltip>
            <Tooltip
              label={t("duplicates.reviewedTooltip", "{{count}} groups already reviewed", {
                count: stats?.reviewed_groups ?? 0,
              })}
            >
              <Button
                variant={statusFilter === "reviewed" ? "filled" : "outline"}
                size="sm"
                onClick={() => setStatusFilter("reviewed")}
              >
                {t("duplicates.reviewed", "Reviewed")} {stats?.reviewed_groups ? `(${stats.reviewed_groups})` : ""}
              </Button>
            </Tooltip>
            <Tooltip
              label={t("duplicates.allTooltip", "{{count}} total duplicate groups", {
                count: stats?.total_groups ?? 0,
              })}
            >
              <Button
                variant={statusFilter === undefined ? "filled" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(undefined)}
              >
                {t("duplicates.all", "All")} {stats?.total_groups ? `(${stats.total_groups})` : ""}
              </Button>
            </Tooltip>
          </Group>
          {totalCount > 0 && (
            <Text size="sm" c="dimmed">
              {t("duplicates.showing", "Showing {{count}} groups", { count: totalCount })}
            </Text>
          )}
        </Group>

        {/* Groups Grid */}
        {groupsLoading ? (
          <Stack align="center" p="xl">
            <Loader size="lg" />
          </Stack>
        ) : groups && groups.length > 0 ? (
          <>
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
              {groups.map(group => (
                <DuplicateGroupCard
                  key={group.id}
                  group={group}
                  onClick={() => setSelectedGroupId(group.id)}
                  onDelete={() => handleDeleteGroup(group.id)}
                />
              ))}
            </SimpleGrid>
            {totalPages > 1 && (
              <Group justify="center" mt="md">
                <Pagination value={page} onChange={setPage} total={totalPages} withEdges />
              </Group>
            )}
          </>
        ) : (
          <Paper p="xl" withBorder>
            <Stack align="center" gap="md">
              <IconCopy size={48} color="gray" />
              <Text size="lg" fw={500}>
                {t("duplicates.noduplicates", "No duplicate groups found")}
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                {statusFilter === "pending"
                  ? t(
                      "duplicates.nopending",
                      "All duplicate groups have been reviewed. Click 'Detect Duplicates' to scan for more."
                    )
                  : t("duplicates.empty", "Click 'Detect Duplicates' to scan your library for duplicate photos.")}
              </Text>
            </Stack>
          </Paper>
        )}
      </Stack>

      {/* Detail Modal */}
      {selectedGroupId && (
        <DuplicateGroupModal
          groupId={selectedGroupId}
          opened={!!selectedGroupId}
          onClose={() => setSelectedGroupId(null)}
        />
      )}
    </Container>
  );
}

export const Route = createFileRoute("/_protected/duplicates")({
  component: DuplicatesPage,
});
