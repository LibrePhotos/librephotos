/**
 * Stacks page content - extracted component for use in unified page.
 *
 * This component focuses on photo organization (not storage cleanup):
 * - Burst sequences: Photos taken in rapid succession
 * - Exposure brackets: HDR bracketed shots
 * - Manual stacks: User-created groupings
 * RAW + JPEG pairs and Live Photos are file variants of one photo, not stacks.
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
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconBolt,
  IconCheck,
  IconChevronDown,
  IconDots,
  IconLayersSubtract,
  IconRefresh,
  IconStack2,
  IconSun,
  IconTrash,
} from "@tabler/icons-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import {
  useDeleteStackMutation,
  useDetectStacksMutation,
  useStacksQuery,
  useStackStatsQuery,
} from "../../api_client/stacks";
import { countListedStacks, StackType } from "../../api_client/stacks/types";
import { buttonRoleProps } from "../../util/a11y";
import { PLACEHOLDER_IMAGE } from "../../util/placeholderImage";
import { EmptyState } from "../common/EmptyState";
import { StackModal } from "../stacks/StackModal";

const validStackTypes: readonly StackType[] = StackType.options;

function getStackTypeIcon(type: StackType) {
  switch (type) {
    case "burst":
      return <IconBolt size={14} />;
    case "bracket":
      return <IconSun size={14} />;
    case "manual":
      return <IconStack2 size={14} />;
    default:
      return <IconLayersSubtract size={14} />;
  }
}

function getStackTypeColor(type: StackType): string {
  switch (type) {
    case "burst":
      return "yellow";
    case "bracket":
      return "lime";
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
      <Group gap={1} wrap="nowrap" aria-label={t("stacks.reviewstack")} {...buttonRoleProps(onClick)}>
        {stack.preview_photos.slice(0, 2).map((photo, index) => (
          <Image
            key={photo.image_hash || index}
            src={photo.thumbnail_url ? `${serverAddress}${photo.thumbnail_url}` : undefined}
            h={100}
            w="50%"
            // Decorative: the surrounding button is named by its aria-label
            alt=""
            fallbackSrc={PLACEHOLDER_IMAGE}
          />
        ))}
      </Group>

      {/* Footer with badges */}
      <Group gap="xs" p="xs" onClick={onClick}>
        <Badge size="sm" variant="light" color={typeColor} leftSection={getStackTypeIcon(stack.stack_type)}>
          {stack.photo_count}
        </Badge>
        <Text size="xs" c="dimmed">
          {t(`stacks.typelabel.${stack.stack_type}`)}
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
            {t("stacks.unstack", "Unstack Photos")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Card>
  );
}

export function StacksPageContent() {
  const { t } = useTranslation();
  // Read synchronously (no SSR here) so phones do not paint the desktop layout for a frame
  const isPhone = useMediaQuery("(max-width: 36em)", undefined, { getInitialValueInEffect: false });
  // Get search params from URL
  const urlParams = new URLSearchParams(window.location.search);
  const typeParam = urlParams.get("type");

  const [selectedStackId, setSelectedStackId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<StackType | undefined>(StackType.safeParse(typeParam).data);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // The backend only runs burst detection (with the user's rules); RAW + JPEG
  // pairs and Live Photos are grouped as file variants during the scan.
  const [detectOptions, setDetectOptions] = useState({ detect_bursts: true });

  // Initialize filters from URL search params
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const typeFromUrl = StackType.safeParse(searchParams.get("type")).data;
    if (typeFromUrl) {
      setTypeFilter(typeFromUrl);
    }
  }, []);

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
  // Show "All Types" always, but filter out empty specific types only if stats are loaded.
  // Legacy RAW + JPEG / Live Photo stacks still show up in the stats, but the list
  // endpoint never returns them, so they get no filter entry and are not counted.
  const allStackTypes: Array<{ value: StackType | ""; label: string; count: number }> = [
    { value: "", label: t("stacks.types.all", "All Types"), count: stats ? countListedStacks(stats) : 0 },
    ...validStackTypes.map(type => ({
      value: type,
      label: t(`stacks.types.${type}`),
      count: stats?.by_type?.[type] ?? 0,
    })),
  ];
  const stackTypes = allStackTypes.filter(type => type.value === "" || !stats || type.count > 0);

  return (
    <Stack gap="lg">
      {/* Filters and Action Buttons */}
      <Group justify="space-between" align="center" mt="md">
        <Group>
          {/* Type filter */}
          <Menu shadow="md" width={200}>
            <Menu.Target>
              <Button variant="light" size="sm" rightSection={<IconChevronDown size={14} />}>
                {typeFilter ? t(`stacks.types.${typeFilter}`) : t("stacks.types.all", "All Types")}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {stackTypes.map(type => (
                <Menu.Item
                  key={type.value}
                  onClick={() => setTypeFilter(type.value || undefined)}
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
        {/* Stacked on phones: side by side the two buttons are wider than the screen */}
        <Group gap="xs" w={isPhone ? "100%" : undefined}>
          <ButtonGroup orientation={isPhone ? "vertical" : "horizontal"} w={isPhone ? "100%" : undefined}>
            <Menu shadow="md" width={300}>
              <Menu.Target>
                <Button variant="outline" size="sm" fullWidth={isPhone} rightSection={<IconChevronDown size={14} />}>
                  {t("stacks.detectOptions", "Detection Options")}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{t("stacks.whatToDetect", "What to Detect")}</Menu.Label>
                <Box px="xs" py={4}>
                  <Stack gap="xs">
                    <Checkbox
                      size="sm"
                      checked={detectOptions.detect_bursts}
                      onChange={e => setDetectOptions(o => ({ ...o, detect_bursts: e.currentTarget.checked }))}
                      label={t("stacks.options.detectbursts", "Burst sequences")}
                    />
                    {detectOptions.detect_bursts && (
                      <Box pl="md">
                        <Text size="xs" c="dimmed">
                          {t("stacks.burstRulesHint", "Configure detection rules in Settings")}
                        </Text>
                      </Box>
                    )}
                  </Stack>
                </Box>
              </Menu.Dropdown>
            </Menu>
            <Button
              size="sm"
              fullWidth={isPhone}
              leftSection={<IconRefresh size={16} />}
              onClick={handleDetect}
              loading={isDetecting}
              // Bursts are the only thing to detect: with it unchecked the job would do nothing
              disabled={!detectOptions.detect_bursts}
            >
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
        <EmptyState
          icon={<IconLayersSubtract size={40} />}
          title={t("stacks.nostacks", "No photo stacks found")}
          description={t("stacks.empty")}
        />
      )}

      {/* Detail Modal */}
      {selectedStackId && (
        <StackModal stackId={selectedStackId} opened={!!selectedStackId} onClose={() => setSelectedStackId(null)} />
      )}
    </Stack>
  );
}
