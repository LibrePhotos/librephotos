/**
 * MetadataSection - Displays structured photo metadata with edit history
 *
 * Features:
 * - Structured camera/lens info from PhotoMetadata
 * - Edit history with undo capability
 * - Visual indicators for user-edited fields
 * - Fallback to Photo model fields for backwards compatibility
 */

import { ActionIcon, Badge, Box, Button, Collapse, Group, Paper, Stack, Text, Timeline, Tooltip } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconCamera, IconChevronDown, IconChevronUp, IconHistory, IconRotateClockwise } from "@tabler/icons-react";
import React from "react";
import {
  useFetchMetadataHistoryQuery,
  useFetchPhotoMetadataQuery,
  useRevertAllMetadataEditsMutation,
  useRevertMetadataEditMutation,
} from "../../api_client/photos/hooks";
import type { MetadataEdit, Photo as PhotoType } from "../../api_client/photos/types";

interface MetadataSectionProps {
  photoDetail: PhotoType;
  isPublic?: boolean;
}

/**
 * Format a metadata field value for display
 */
function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Get a human-readable label for a field name
 */
function getFieldLabel(fieldName: string): string {
  const labels: Record<string, string> = {
    aperture: "Aperture",
    shutter_speed: "Shutter Speed",
    iso: "ISO",
    focal_length: "Focal Length",
    focal_length_35mm: "Focal Length (35mm)",
    camera_make: "Camera Make",
    camera_model: "Camera Model",
    lens_make: "Lens Make",
    lens_model: "Lens Model",
    title: "Title",
    caption: "Caption",
    keywords: "Keywords",
    rating: "Rating",
    copyright: "Copyright",
    creator: "Creator",
    date_taken: "Date Taken",
    gps_latitude: "GPS Latitude",
    gps_longitude: "GPS Longitude",
    _all: "All Fields",
  };
  return labels[fieldName] || fieldName.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Calculate time ago string
 */
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/**
 * Single edit history item with revert action
 */
function EditHistoryItem({
  edit,
  onRevert,
  isReverting,
}: {
  edit: MetadataEdit;
  onRevert: () => void;
  isReverting: boolean;
}) {
  const date = new Date(edit.created_at);
  const timeAgo = getTimeAgo(date);

  return (
    <Timeline.Item
      bullet={<IconHistory size={12} />}
      title={
        <Group justify="space-between">
          <Text size="sm" fw={500}>
            {getFieldLabel(edit.field_name)}
          </Text>
          <Tooltip label="Revert this change">
            <ActionIcon size="sm" variant="subtle" color="gray" onClick={onRevert} loading={isReverting}>
              <IconRotateClockwise size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>
      }
    >
      <Text size="xs" c="dimmed">
        {formatFieldValue(edit.old_value)} → {formatFieldValue(edit.new_value)}
      </Text>
      <Text size="xs" c="dimmed">
        {edit.user_name} • {timeAgo}
      </Text>
    </Timeline.Item>
  );
}

/**
 * Calculate time ago string
 */
function getTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

/**
 * Camera info display using structured metadata
 */
function CameraInfo({
  metadata,
  fallbackPhoto,
}: {
  metadata?: { camera_display: string | null; lens_display: string | null };
  fallbackPhoto: PhotoType;
}) {
  const camera = metadata?.camera_display || fallbackPhoto.camera;
  const lens = metadata?.lens_display || fallbackPhoto.lens;

  if (!camera && !lens) return null;

  return (
    <Group gap="xs" wrap="nowrap">
      <IconCamera size={16} />
      <Box>
        {camera && (
          <Text size="sm" fw={600}>
            {camera}
          </Text>
        )}
        {lens && (
          <Text size="xs" c="dimmed">
            {lens}
          </Text>
        )}
      </Box>
    </Group>
  );
}

/**
 * Capture settings display (aperture, shutter speed, ISO, focal length)
 */
function CaptureSettings({
  metadata,
  fallbackPhoto,
}: {
  metadata?: {
    aperture: number | null;
    shutter_speed: string | null;
    iso: number | null;
    focal_length: number | null;
    focal_length_35mm: number | null;
  };
  fallbackPhoto: PhotoType;
}) {
  const aperture = metadata?.aperture ?? fallbackPhoto.fstop;
  const shutterSpeed = metadata?.shutter_speed ?? fallbackPhoto.shutter_speed;
  const iso = metadata?.iso ?? fallbackPhoto.iso;
  const focalLength = metadata?.focal_length ?? fallbackPhoto.focal_length;
  const focalLength35 = metadata?.focal_length_35mm ?? fallbackPhoto.focalLength35Equivalent;

  // Don't render if no capture settings
  if (!aperture && !shutterSpeed && !iso && !focalLength) return null;

  return (
    <Group gap="md" wrap="wrap">
      {aperture && (
        <Box>
          <Text size="xs" c="dimmed">
            Aperture
          </Text>
          <Text size="sm">ƒ/{aperture}</Text>
        </Box>
      )}
      {shutterSpeed && (
        <Box>
          <Text size="xs" c="dimmed">
            Shutter
          </Text>
          <Text size="sm">{shutterSpeed}</Text>
        </Box>
      )}
      {iso && (
        <Box>
          <Text size="xs" c="dimmed">
            ISO
          </Text>
          <Text size="sm">{iso}</Text>
        </Box>
      )}
      {focalLength && (
        <Box>
          <Text size="xs" c="dimmed">
            Focal Length
          </Text>
          <Text size="sm">
            {Math.round(focalLength)}mm
            {focalLength35 && ` (${Math.round(focalLength35)}mm eq)`}
          </Text>
        </Box>
      )}
    </Group>
  );
}

/**
 * Image properties display (resolution, megapixels)
 */
function ImageProperties({
  metadata,
  fallbackPhoto,
}: {
  metadata?: {
    resolution: string | null;
    megapixels: number | null;
    width: number | null;
    height: number | null;
  };
  fallbackPhoto: PhotoType;
}) {
  const resolution =
    metadata?.resolution ||
    (fallbackPhoto.width && fallbackPhoto.height ? `${fallbackPhoto.width} × ${fallbackPhoto.height}` : null);
  const megapixels =
    metadata?.megapixels ||
    (fallbackPhoto.width && fallbackPhoto.height
      ? Math.round(((fallbackPhoto.width * fallbackPhoto.height) / 1000000) * 10) / 10
      : null);

  if (!resolution) return null;

  return (
    <Group gap="md">
      <Box>
        <Text size="xs" c="dimmed">
          Resolution
        </Text>
        <Text size="sm">{resolution}</Text>
      </Box>
      {megapixels && (
        <Box>
          <Text size="xs" c="dimmed">
            Megapixels
          </Text>
          <Text size="sm">{megapixels} MP</Text>
        </Box>
      )}
    </Group>
  );
}

/**
 * Main MetadataSection component
 */
export function MetadataSection({ photoDetail, isPublic = false }: MetadataSectionProps) {
  const [historyOpen, { toggle: toggleHistory }] = useDisclosure(false);

  // Fetch full metadata (optional - enhances display if available)
  const { data: fullMetadata } = useFetchPhotoMetadataQuery(photoDetail.id, { enabled: !isPublic });

  // Fetch edit history (only if metadata exists and has edits)
  const { data: historyData } = useFetchMetadataHistoryQuery(photoDetail.id, 1, 10, {
    enabled: !isPublic && !!fullMetadata?.has_edits,
  });

  // Mutations for reverting edits
  const { mutate: revertEdit, isPending: isRevertingEdit } = useRevertMetadataEditMutation();
  const { mutate: revertAll, isPending: isRevertingAll } = useRevertAllMetadataEditsMutation();

  // Use metadata from photo summary (included in PhotoSerializer)
  const summaryMetadata = photoDetail.metadata;

  // Check if there are any user edits
  const hasEdits = summaryMetadata?.has_edits || fullMetadata?.has_edits;
  const editCount = historyData?.count || 0;

  return (
    <Stack gap="sm">
      {/* Camera info */}
      <CameraInfo metadata={summaryMetadata} fallbackPhoto={photoDetail} />

      {/* Capture settings */}
      <CaptureSettings metadata={summaryMetadata} fallbackPhoto={photoDetail} />

      {/* Image properties */}
      <ImageProperties metadata={fullMetadata} fallbackPhoto={photoDetail} />

      {/* Edit indicator badge */}
      {hasEdits && (
        <Group gap="xs">
          <Badge size="xs" variant="light" color="blue">
            User Edited
          </Badge>
          {!isPublic && editCount > 0 && (
            <Badge
              size="xs"
              variant="light"
              color="gray"
              style={{ cursor: "pointer" }}
              onClick={toggleHistory}
              rightSection={historyOpen ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
            >
              {editCount} edit{editCount !== 1 ? "s" : ""}
            </Badge>
          )}
        </Group>
      )}

      {/* Edit history (collapsible) */}
      {!isPublic && (
        <Collapse in={historyOpen}>
          <Paper p="xs" withBorder>
            <Stack gap="sm">
              <Group justify="space-between">
                <Text size="sm" fw={500}>
                  Edit History
                </Text>
                {editCount > 0 && (
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconRotateClockwise size={14} />}
                    onClick={() => revertAll(photoDetail.id)}
                    loading={isRevertingAll}
                  >
                    Revert All
                  </Button>
                )}
              </Group>

              {historyData && historyData.results.length > 0 ? (
                <Timeline active={-1} bulletSize={18} lineWidth={2}>
                  {historyData.results.map(edit => (
                    <EditHistoryItem
                      key={edit.id}
                      edit={edit}
                      onRevert={() => revertEdit({ photoId: photoDetail.id, editId: edit.id })}
                      isReverting={isRevertingEdit}
                    />
                  ))}
                </Timeline>
              ) : (
                <Text size="sm" c="dimmed" ta="center">
                  No edit history
                </Text>
              )}
            </Stack>
          </Paper>
        </Collapse>
      )}
    </Stack>
  );
}
