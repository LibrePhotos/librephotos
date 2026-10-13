import type { Photo } from "@librephotos/api-client";
import { Button, Group, Text } from "@mantine/core";
import { IconArrowsMaximize, IconCopy, IconInfoCircle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { PhotoCard } from "./PhotoCard";

type Props = Readonly<{
  photo: Pick<Photo, "owner">;
  onOpenViewer: () => void;
  /** Absent where the browser has no image clipboard, and for a video. */
  onCopy?: () => void;
}>;

/**
 * A photo someone shared with the viewer: what the lightbox shows them too.
 * The date and place name are in the page title; everything else, and every
 * action that changes the photo, stays the owner's.
 */
export function SharedPhotoDetails({ photo, onOpenViewer, onCopy }: Props) {
  const { t } = useTranslation();
  const ownerName = [photo.owner.first_name, photo.owner.last_name].filter(Boolean).join(" ") || photo.owner.username;
  return (
    <>
      <Group gap="xs">
        <Button variant="default" leftSection={<IconArrowsMaximize size={16} />} onClick={onOpenViewer}>
          {t("photopage.openinviewer")}
        </Button>
        {onCopy && (
          <Button variant="default" leftSection={<IconCopy size={16} />} onClick={onCopy}>
            {t("photopage.more.copy")}
          </Button>
        )}
      </Group>
      <PhotoCard icon={IconInfoCircle} color="gray" title={t("photopage.sharedby", { name: ownerName })}>
        <Text size="sm" c="dimmed">
          {t("lightbox.sidebar.ownerOnlyMoreDetails")}
        </Text>
      </PhotoCard>
    </>
  );
}
