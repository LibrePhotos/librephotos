import type { DuplicateListItem } from "@librephotos/api-client";
import { ActionIcon, Badge, Card, Checkbox, Group, Image, Menu, Tooltip } from "@mantine/core";
import { IconDots, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/urls";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { buttonRoleProps } from "../../util/a11y";
import { formatFileSize } from "../../util/fileSize";
import { PLACEHOLDER_IMAGE } from "../../util/placeholderImage";
import classes from "./DuplicatesPageContent.module.css";
import { getDuplicateTypeColor, getDuplicateTypeIcon } from "./duplicateTypeDisplay";

export function DuplicateCard({
  duplicate,
  onClick,
  onDelete,
  isSelected = false,
  onToggleSelect,
}: {
  duplicate: DuplicateListItem;
  onClick: () => void;
  onDelete: () => void;
  isSelected?: boolean;
  onToggleSelect?: () => void;
}) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const isResolved = duplicate.review_status === "resolved";
  const isDismissed = duplicate.review_status === "dismissed";
  const isPending = duplicate.review_status === "pending";
  const typeColor = getDuplicateTypeColor(duplicate.duplicate_type);

  return (
    <Card padding={0} radius="md" withBorder className={classes.groupCard} data-selected={isSelected || undefined}>
      {/* Selection checkbox */}
      {onToggleSelect && (
        <Checkbox
          checked={isSelected}
          onChange={e => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className={classes.selectCheckbox}
          pos="absolute"
          top="8px"
          left="8px"
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
            opacity={isResolved || isDismissed ? 0.6 : 1}
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
          <Tooltip label={t("duplicates.potentialSavings")}>
            <Badge size="sm" variant="outline" color="red">
              {formatFileSize(duplicate.potential_savings, locale)}
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
            className={classes.menuButton}
            pos="absolute"
            top="4px"
            right="4px"
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
            {t("duplicates.deleteGroup")}
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Card>
  );
}
