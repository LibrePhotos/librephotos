import {
  Accordion,
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
import { IconFile, IconLayersLinked, IconPhoto, IconPlayerPlay, IconStack2 } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";
import { serverAddress } from "../../api_client/apiClient";
import type { Photo, PhotoStackDetail, StackTypeEnum } from "../../api_client/photos/types";

interface StackSectionProps {
  photoDetail: Photo;
}

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

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`;
}

interface SingleStackCardProps {
  stack: PhotoStackDetail;
  photoId: string;
  t: TFunction;
  isCompact?: boolean;
}

function SingleStackCard({ stack, photoId, t, isCompact = false }: SingleStackCardProps) {
  const icon = stackTypeIcons[stack.type];
  const color = stackTypeColors[stack.type];

  return (
    <Card withBorder p="xs">
      <Stack gap="xs">
        <Group gap="xs" justify="space-between">
          <Group gap="xs">
            <Badge size="sm" color={color} variant="light" leftSection={icon}>
              {stack.type_display}
            </Badge>
            <Text size="sm" c="dimmed">
              {t("lightbox.sidebar.stackPhotos", "{{count}} photos", { count: stack.photo_count })}
            </Text>
          </Group>
        </Group>

        {!isCompact && (
          <>
            {/* Stack photo thumbnails */}
            <ScrollArea.Autosize type="auto" mah={160}>
              <SimpleGrid cols={4} spacing="xs">
                {stack.photos.map(stackPhoto => (
                  <Tooltip
                    key={stackPhoto.id}
                    label={
                      <Stack gap={2}>
                        <Text size="xs">
                          {stackPhoto.width}x{stackPhoto.height}
                        </Text>
                        <Text size="xs">{formatBytes(stackPhoto.size)}</Text>
                        {stackPhoto.is_primary && (
                          <Text size="xs" fw={700}>
                            {t("lightbox.sidebar.primary", "Primary")}
                          </Text>
                        )}
                      </Stack>
                    }
                  >
                    <Card
                      p={0}
                      withBorder
                      style={{
                        borderColor: stackPhoto.is_primary ? "var(--mantine-color-blue-5)" : undefined,
                        borderWidth: stackPhoto.is_primary ? 2 : 1,
                        opacity: stackPhoto.id === photoId ? 1 : 0.7,
                      }}
                    >
                      <Image
                        src={stackPhoto.thumbnail_url ? `${serverAddress}${stackPhoto.thumbnail_url}` : undefined}
                        alt=""
                        h={60}
                        fit="cover"
                        fallbackSrc="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><rect fill='%23ddd' width='60' height='60'/></svg>"
                      />
                    </Card>
                  </Tooltip>
                ))}
              </SimpleGrid>
            </ScrollArea.Autosize>
          </>
        )}
      </Stack>
    </Card>
  );
}

export function StackSection({ photoDetail }: StackSectionProps) {
  const { t } = useTranslation();
  const stacks = photoDetail.stacks as PhotoStackDetail[] | null | undefined;

  if (!stacks || stacks.length === 0) {
    return null;
  }

  // Single stack - show it directly without accordion
  if (stacks.length === 1) {
    return (
      <Stack gap="xs">
        <Title order={5}>{t("lightbox.sidebar.stack", "Stack")}</Title>
        <SingleStackCard stack={stacks[0]} photoId={photoDetail.id} t={t} />
      </Stack>
    );
  }

  // Multiple stacks - show in accordion for organization
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Title order={5}>{t("lightbox.sidebar.stacks", "Stacks")}</Title>
        <Badge size="sm" variant="light" color="gray">
          {stacks.length}
        </Badge>
      </Group>

      <Text size="xs" c="dimmed">
        {t("lightbox.sidebar.multipleStacksInfo", "This photo belongs to multiple groupings")}
      </Text>

      <Accordion variant="separated" radius="sm" defaultValue={stacks[0].type}>
        {stacks.map(stack => {
          const icon = stackTypeIcons[stack.type];
          const color = stackTypeColors[stack.type];

          return (
            <Accordion.Item key={stack.id} value={stack.type}>
              <Accordion.Control icon={icon}>
                <Group gap="xs">
                  <Text size="sm" fw={500}>
                    {stack.type_display}
                  </Text>
                  <Badge size="xs" color={color} variant="light">
                    {stack.photo_count}
                  </Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  {/* Stack photo thumbnails */}
                  <ScrollArea.Autosize type="auto" mah={160}>
                    <SimpleGrid cols={4} spacing="xs">
                      {stack.photos.map(stackPhoto => (
                        <Tooltip
                          key={stackPhoto.id}
                          label={
                            <Stack gap={2}>
                              <Text size="xs">
                                {stackPhoto.width}x{stackPhoto.height}
                              </Text>
                              <Text size="xs">{formatBytes(stackPhoto.size)}</Text>
                              {stackPhoto.is_primary && (
                                <Text size="xs" fw={700}>
                                  {t("lightbox.sidebar.primary", "Primary")}
                                </Text>
                              )}
                            </Stack>
                          }
                        >
                          <Card
                            p={0}
                            withBorder
                            style={{
                              borderColor: stackPhoto.is_primary ? "var(--mantine-color-blue-5)" : undefined,
                              borderWidth: stackPhoto.is_primary ? 2 : 1,
                              opacity: stackPhoto.id === photoDetail.id ? 1 : 0.7,
                            }}
                          >
                            <Image
                              src={stackPhoto.thumbnail_url ? `${serverAddress}${stackPhoto.thumbnail_url}` : undefined}
                              alt=""
                              h={60}
                              fit="cover"
                              fallbackSrc="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><rect fill='%23ddd' width='60' height='60'/></svg>"
                            />
                          </Card>
                        </Tooltip>
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
  );
}
