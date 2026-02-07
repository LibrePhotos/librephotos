/**
 * Stacks page content - extracted component for use in unified page.
 *
 * This component focuses on photo organization (not storage cleanup):
 * - RAW + JPEG pairs: Keep both versions linked
 * - Burst sequences: Photos taken in rapid succession
 * - Exposure brackets: HDR bracketed shots
 * - Live Photos: Photo with embedded video
 * - Manual stacks: User-created groupings
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Card,
  Checkbox,
  Group,
  Image,
  Loader,
  Menu,
  Pagination,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import {
  IconBolt,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconDots,
  IconLayersSubtract,
  IconRefresh,
  IconStack2,
  IconSun,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import { useAccessToken } from "../../api_client/auth";
import {
  useDeleteStackMutation,
  useDetectStacksMutation,
  useStacksQuery,
  useStackStatsQuery,
} from "../../api_client/stacks";
import type { StackType } from "../../api_client/stacks/types";
import { stackTypeLabels } from "../../api_client/stacks/types";
import { useFetchUserSelfDetailsQuery } from "../../api_client/user/hooks";
import { StackModal } from "../stacks/StackModal";

function getStackTypeIcon(type: StackType) {
  switch (type) {
    case "raw_jpeg":
      return <IconCamera size={14} />;
    case "burst":
      return <IconBolt size={14} />;
    case "bracket":
      return <IconSun size={14} />;
    case "live_photo":
      return <IconVideo size={14} />;
    case "manual":
      return <IconStack2 size={14} />;
    default:
      return <IconLayersSubtract size={14} />;
  }
}

function getStackTypeColor(type: StackType): string {
  switch (type) {
    case "raw_jpeg":
      return "cyan";
    case "burst":
      return "yellow";
    case "bracket":
      return "lime";
    case "live_photo":
      return "grape";
    case "manual":
      return "blue";
    default:
      return "gray";
  }
}

// Stack list item type
interface StackListItem {
  id: string;
  stack_type: StackType;
  stack_type_display: string;
  photo_count: number;
  preview_photos: Array<{
    image_hash: string;
    thumbnail_url: string | null;
  }>;
}

function StackCard({ stack, onClick, onDelete }: { stack: StackListItem; onClick: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const typeColor = getStackTypeColor(stack.stack_type);

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
      {/* Image Preview */}
      <Group gap={1} wrap="nowrap" onClick={onClick}>
        {stack.preview_photos.slice(0, 2).map((photo, index) => (
          <Image
            key={photo.image_hash || index}
            src={photo.thumbnail_url ? `${serverAddress}${photo.thumbnail_url}` : undefined}
            h={100}
            w="50%"
            alt="Preview"
            fallbackSrc="https://placehold.co/100x100?text=?"
          />
        ))}
      </Group>

      {/* Footer with badges */}
      <Group gap="xs" p="xs" onClick={onClick}>
        <Badge size="sm" variant="light" color={typeColor} leftSection={getStackTypeIcon(stack.stack_type)}>
          {stack.photo_count}
        </Badge>
        <Text size="xs" c="dimmed">
          {stack.stack_type_display}
        </Text>
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
            {t("stacks.unstack", "Unstack Photos")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Card>
  );
}

export function StacksPageContent() {
  const { t } = useTranslation();
  // Get search params from URL
  const urlParams = new URLSearchParams(window.location.search);
  const typeParam = urlParams.get("type");

  const { data: auth } = useAccessToken();
  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(auth?.access?.user_id.toString() ?? "");

  const [selectedStackId, setSelectedStackId] = useState<string | null>(null);
  const validStackTypes: StackType[] = ["raw_jpeg", "burst", "bracket", "live_photo", "manual"];
  const [typeFilter, setTypeFilter] = useState<StackType | undefined>(
    typeParam && validStackTypes.includes(typeParam as StackType) ? (typeParam as StackType) : undefined
  );
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Detection options - initialized from user settings
  const [detectOptions, setDetectOptions] = useState({
    detect_raw_jpeg: userSelfDetails?.stack_raw_jpeg !== false, // Default to true if not set
    detect_bursts: true,
    detect_live_photos: true,
  });

  // Initialize filters from URL search params
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const typeFromUrl = searchParams.get("type");
    if (typeFromUrl && validStackTypes.includes(typeFromUrl as StackType)) {
      setTypeFilter(typeFromUrl as StackType);
    }
  }, []);

  // Update detection options when user settings load
  useEffect(() => {
    if (userSelfDetails) {
      setDetectOptions(prev => ({
        ...prev,
        detect_raw_jpeg: userSelfDetails.stack_raw_jpeg !== false,
      }));
    }
  }, [userSelfDetails]);

  const { data: stats } = useStackStatsQuery();
  const { data: stacksResponse, isLoading: stacksLoading } = useStacksQuery({
    stack_type: typeFilter,
    page,
    page_size: pageSize,
  });
  const { mutate: detectStacks, isPending: isDetecting } = useDetectStacksMutation();
  const { mutate: deleteStack } = useDeleteStackMutation();

  const stacks = stacksResponse?.results ?? [];
  const totalPages = stacksResponse?.num_pages ?? 1;
  const totalCount = stacksResponse?.count ?? 0;

  const handleDetect = () => {
    detectStacks(detectOptions);
  };

  const handleDeleteStack = (id: string) => {
    deleteStack(id);
  };

  // Reset page when filter changes
  React.useEffect(() => {
    setPage(1);
  }, [typeFilter]);

  // Build stack types list with counts, filtering out empty types
  // Show "All Types" always, but filter out empty specific types only if stats are loaded
  const stackTypes: Array<{ value: string; label: string; count: number }> = [
    { value: "", label: t("stacks.allTypes", "All Types"), count: stats?.total_stacks ?? 0 },
    { value: "raw_jpeg", label: stackTypeLabels.raw_jpeg, count: stats?.by_type?.raw_jpeg ?? 0 },
    { value: "burst", label: stackTypeLabels.burst, count: stats?.by_type?.burst ?? 0 },
    { value: "bracket", label: stackTypeLabels.bracket, count: stats?.by_type?.bracket ?? 0 },
    { value: "live_photo", label: stackTypeLabels.live_photo, count: stats?.by_type?.live_photo ?? 0 },
    { value: "manual", label: stackTypeLabels.manual, count: stats?.by_type?.manual ?? 0 },
  ].filter(type => type.value === "" || !stats || type.count > 0); // Show "All Types" always, filter empty types only when stats are loaded

  return (
    <Stack gap="lg">
      {/* Filters and Action Buttons */}
      <Group justify="space-between" align="center" mt="md">
        <Group>
          {/* Type filter */}
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <Button variant="light" size="sm" rightSection={<IconChevronDown size={14} />}>
                {typeFilter ? stackTypeLabels[typeFilter] : t("stacks.allTypes", "All Types")}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {stackTypes.map(type => (
                <Menu.Item
                  key={type.value}
                  onClick={() => setTypeFilter((type.value || undefined) as StackType | undefined)}
                  rightSection={
                    typeFilter === type.value || (!typeFilter && !type.value) ? <IconCheck size={14} /> : null
                  }
                >
                  <Group justify="space-between" style={{ width: "100%" }}>
                    <Text>{type.label}</Text>
                    {type.value && (
                      <Badge size="xs" variant="light">
                        {type.count}
                      </Badge>
                    )}
                  </Group>
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
                  {t("stacks.detectOptions", "Detection Options")}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{t("stacks.whatToDetect", "What to Detect")}</Menu.Label>
                <Box px="xs" py={4}>
                  <Stack gap="xs">
                    <Checkbox
                      size="sm"
                      checked={detectOptions.detect_raw_jpeg}
                      onChange={e => setDetectOptions(o => ({ ...o, detect_raw_jpeg: e.currentTarget.checked }))}
                      label={t("stacks.detectRawJpeg", "RAW + JPEG pairs")}
                    />
                    <Checkbox
                      size="sm"
                      checked={detectOptions.detect_bursts}
                      onChange={e => setDetectOptions(o => ({ ...o, detect_bursts: e.currentTarget.checked }))}
                      label={t("stacks.detectBursts", "Burst sequences")}
                    />
                    {detectOptions.detect_bursts && (
                      <Box pl="md">
                        <Text size="xs" c="dimmed">
                          {t("stacks.burstRulesHint", "Configure detection rules in Settings")}
                        </Text>
                      </Box>
                    )}
                    <Checkbox
                      size="sm"
                      checked={detectOptions.detect_live_photos}
                      onChange={e => setDetectOptions(o => ({ ...o, detect_live_photos: e.currentTarget.checked }))}
                      label={t("stacks.detectLivePhotos", "Live Photos")}
                    />
                  </Stack>
                </Box>
              </Menu.Dropdown>
            </Menu>
            <Button size="sm" leftSection={<IconRefresh size={16} />} onClick={handleDetect} loading={isDetecting}>
              {t("stacks.detect", "Detect Stacks")}
            </Button>
          </ButtonGroup>
        </Group>
      </Group>

      {/* Stacks Grid */}
      {stacksLoading ? (
        <Stack align="center" p="xl">
          <Loader size="lg" />
        </Stack>
      ) : stacks && stacks.length > 0 ? (
        <>
          <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} spacing="md">
            {stacks.map((stack: StackListItem) => (
              <StackCard
                key={stack.id}
                stack={stack}
                onClick={() => setSelectedStackId(stack.id)}
                onDelete={() => handleDeleteStack(stack.id)}
              />
            ))}
          </SimpleGrid>
          {totalPages > 1 && (
            <Group justify="center" mt="md" gap="md">
              {totalCount > 0 && (
                <Text size="sm" c="dimmed">
                  {t("stacks.showing", "Showing {{count}} stacks", { count: totalCount })}
                </Text>
              )}
              <Pagination value={page} onChange={setPage} total={totalPages} withEdges />
            </Group>
          )}
        </>
      ) : (
        <Paper p="xl" withBorder>
          <Stack align="center" gap="md">
            <IconLayersSubtract size={48} color="gray" />
            <Text size="lg" fw={500}>
              {t("stacks.noStacks", "No photo stacks found")}
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              {t("stacks.empty", "Click 'Detect Stacks' to find RAW+JPEG pairs, bursts, and other related photos.")}
            </Text>
          </Stack>
        </Paper>
      )}

      {/* Detail Modal */}
      {selectedStackId && (
        <StackModal stackId={selectedStackId} opened={!!selectedStackId} onClose={() => setSelectedStackId(null)} />
      )}
    </Stack>
  );
}
