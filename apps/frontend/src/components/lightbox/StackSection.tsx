import type { Photo, PhotoStackDetail, StackPhotoDetail, StackTypeEnum } from "@librephotos/api-client";
import {
  Accordion,
  ActionIcon,
  Badge,
  Card,
  Group,
  Image,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconExternalLink,
  IconFile,
  IconLayersLinked,
  IconPhoto,
  IconPlayerPlay,
  IconStack2,
} from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/urls";
import { useFormatLocale } from "../../hooks/useFormatLocale";
import { buttonRoleProps } from "../../util/a11y";
import { formatFileSize } from "../../util/fileSize";
import { PLACEHOLDER_IMAGE } from "../../util/placeholderImage";
import { StackModal } from "../stacks/StackModal";

type StackSectionProps = {
  photoDetail: Pick<Photo, "id" | "stacks">;
  onPhotoSelect?: (photoId: string) => void;
};

const stackTypeIcons: Record<StackTypeEnum, React.ReactNode> = {
  raw_jpeg: <IconFile size={16} />,
  burst: <IconPlayerPlay size={16} />,
  bracket: <IconLayersLinked size={16} />,
  live_photo: <IconPhoto size={16} />,
  manual: <IconStack2 size={16} />,
};

const stackTypeColors: Record<StackTypeEnum, string> = {
  raw_jpeg: "blue",
  burst: "grape",
  bracket: "cyan",
  live_photo: "green",
  manual: "gray",
};

type StackPhotoThumbnailProps = {
  stackPhoto: StackPhotoDetail;
  /** Its accessible name, e.g. "Photo 2 of 3". */
  label: string;
  /** The photo the lightbox shows now. */
  isCurrent: boolean;
  onPhotoSelect?: (photoId: string) => void;
};

/**
 * One photo of a stack. Another photo of the stack is a button that switches to it (Tab, then
 * Enter or Space, like a click); the one on screen is marked aria-current and does nothing.
 */
function StackPhotoThumbnail({ stackPhoto, label, isCurrent, onPhotoSelect }: StackPhotoThumbnailProps) {
  const { t } = useTranslation();
  const locale = useFormatLocale();
  const selectable = onPhotoSelect !== undefined && !isCurrent;
  const interaction = selectable
    ? buttonRoleProps(() => onPhotoSelect(stackPhoto.id))
    : { role: "img" as const, "aria-current": isCurrent ? ("true" as const) : undefined };

  return (
    <Tooltip
      label={
        <Stack gap={2}>
          <Text size="xs">
            {stackPhoto.width} × {stackPhoto.height}
          </Text>
          <Text size="xs">{formatFileSize(stackPhoto.size ?? 0, locale)}</Text>
          {stackPhoto.is_primary && (
            <Text size="xs" fw={700}>
              {t("lightbox.sidebar.primary")}
            </Text>
          )}
          {selectable && (
            <Text size="xs" c="blue">
              {t("lightbox.sidebar.clickToView")}
            </Text>
          )}
        </Stack>
      }
    >
      <Card
        p={0}
        withBorder
        aria-label={label}
        {...interaction}
        style={{
          borderColor: stackPhoto.is_primary ? "var(--mantine-color-blue-5)" : undefined,
          borderWidth: stackPhoto.is_primary ? 2 : 1,
          opacity: isCurrent ? 1 : 0.7,
          cursor: selectable ? "pointer" : "default",
        }}
      >
        <Image
          src={stackPhoto.thumbnail_url ? `${serverAddress}${stackPhoto.thumbnail_url}` : undefined}
          alt=""
          h={60}
          fit="cover"
          fallbackSrc={PLACEHOLDER_IMAGE}
        />
      </Card>
    </Tooltip>
  );
}

type SingleStackCardProps = {
  stack: PhotoStackDetail;
  photoId: string;
  t: TFunction;
  isCompact?: boolean;
  onPhotoSelect?: (photoId: string) => void;
};

function SingleStackCard({ stack, photoId, t, isCompact = false, onPhotoSelect }: SingleStackCardProps) {
  const icon = stackTypeIcons[stack.type];
  const color = stackTypeColors[stack.type];

  return (
    <Card withBorder p="xs">
      <Stack gap="xs">
        <Group gap="xs" justify="space-between">
          <Group gap="xs">
            <Badge size="sm" color={color} variant="light" leftSection={icon}>
              {/* Translated, not the server's English type_display (kept as the fallback) */}
              {t(`stacks.typelabel.${stack.type}`)}
            </Badge>
            <Text size="sm" c="dimmed">
              {t("lightbox.sidebar.stackPhotos", { count: stack.photo_count })}
            </Text>
          </Group>
        </Group>

        {!isCompact && (
          <>
            {/* Stack photo thumbnails */}
            <ScrollArea.Autosize type="auto" mah={160}>
              <SimpleGrid cols={4} spacing="xs">
                {stack.photos.map((stackPhoto, index) => (
                  <StackPhotoThumbnail
                    key={stackPhoto.id}
                    stackPhoto={stackPhoto}
                    label={t("photoofcount", { index: index + 1, count: stack.photos.length })}
                    isCurrent={stackPhoto.id === photoId}
                    onPhotoSelect={onPhotoSelect}
                  />
                ))}
              </SimpleGrid>
            </ScrollArea.Autosize>
          </>
        )}
      </Stack>
    </Card>
  );
}

export function StackSection({ photoDetail, onPhotoSelect }: StackSectionProps) {
  const { t } = useTranslation();
  const { stacks } = photoDetail;
  const [selectedStackId, setSelectedStackId] = useState<string | null>(null);

  const firstStack = stacks?.[0];
  if (!stacks || firstStack === undefined) {
    return null;
  }

  // Single stack - show it directly without accordion
  if (stacks.length === 1) {
    return (
      <>
        <Stack gap="xs">
          <Group justify="space-between">
            <Group>
              <IconStack2 />
              <Title order={4}>{t("lightbox.sidebar.stack")}</Title>
            </Group>
            <Tooltip label={t("lightbox.sidebar.openStack")}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={t("lightbox.sidebar.openStack")}
                onClick={() => setSelectedStackId(firstStack.id)}
              >
                <IconExternalLink size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
          <SingleStackCard stack={firstStack} photoId={photoDetail.id} t={t} onPhotoSelect={onPhotoSelect} />
        </Stack>

        {selectedStackId && (
          <StackModal stackId={selectedStackId} opened={!!selectedStackId} onClose={() => setSelectedStackId(null)} />
        )}
      </>
    );
  }

  // Multiple stacks - show in accordion for organization
  return (
    <>
      <Stack gap="xs">
        <Group>
          <IconStack2 />
          <Group gap="xs">
            <Title order={4}>{t("lightbox.sidebar.stacks")}</Title>
            <Badge size="sm" variant="light" color="gray">
              {stacks.length}
            </Badge>
          </Group>
        </Group>

        <Text size="xs" c="dimmed">
          {t("lightbox.sidebar.multipleStacksInfo")}
        </Text>

        <Accordion variant="separated" radius="sm" defaultValue={firstStack.type}>
          {stacks.map(stack => {
            const icon = stackTypeIcons[stack.type];
            const color = stackTypeColors[stack.type];

            return (
              <Accordion.Item key={stack.id} value={stack.type}>
                <Accordion.Control icon={icon}>
                  <Group gap="xs" justify="space-between" style={{ width: "100%" }}>
                    <Group gap="xs">
                      <Text size="sm" fw={500}>
                        {t(`stacks.typelabel.${stack.type}`)}
                      </Text>
                      <Badge size="xs" color={color} variant="light">
                        {stack.photo_count}
                      </Badge>
                    </Group>
                    <Tooltip label={t("lightbox.sidebar.openStack")}>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="xs"
                        aria-label={t("lightbox.sidebar.openStack")}
                        onClick={e => {
                          e.stopPropagation();
                          setSelectedStackId(stack.id);
                        }}
                      >
                        <IconExternalLink size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    {/* Stack photo thumbnails */}
                    <ScrollArea.Autosize type="auto" mah={160}>
                      <SimpleGrid cols={4} spacing="xs">
                        {stack.photos.map((stackPhoto, index) => (
                          <StackPhotoThumbnail
                            key={stackPhoto.id}
                            stackPhoto={stackPhoto}
                            label={t("photoofcount", { index: index + 1, count: stack.photos.length })}
                            isCurrent={stackPhoto.id === photoDetail.id}
                            onPhotoSelect={onPhotoSelect}
                          />
                        ))}
                      </SimpleGrid>
                    </ScrollArea.Autosize>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      </Stack>

      {selectedStackId && (
        <StackModal stackId={selectedStackId} opened={!!selectedStackId} onClose={() => setSelectedStackId(null)} />
      )}
    </>
  );
}
