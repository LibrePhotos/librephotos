import { Box, Button, Group, Modal, SimpleGrid, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { IconInfoCircle, IconPhoto } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { PigPhoto } from "../../api_client/photos/types";
import { Media } from "../../api_client/photos/types";
import { Tile } from "../Tile";
import classes from "./AlbumCoverPickerModal.module.css";

const PHOTOS_PER_PAGE = 50;

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  photos: PigPhoto[];
  onSelectCover: (photoId: string) => void;
  albumTitle?: string;
}>;

export function AlbumCoverPickerModal({ isOpen, onRequestClose, photos, onSelectCover, albumTitle }: Props) {
  const { t } = useTranslation();
  const [visibleCount, setVisibleCount] = useState(PHOTOS_PER_PAGE);

  const handleSelectPhoto = (photoId: string) => {
    onSelectCover(photoId);
    onRequestClose();
  };

  const handleLoadMore = () => {
    setVisibleCount(prev => prev + PHOTOS_PER_PAGE);
  };

  // Reset visible count when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setVisibleCount(PHOTOS_PER_PAGE);
    }
  }, [isOpen]);

  const visiblePhotos = photos.slice(0, visibleCount);
  const hasMore = visibleCount < photos.length;
  const remainingCount = photos.length - visibleCount;

  return (
    <Modal
      zIndex={1500}
      opened={isOpen}
      title={<Title order={3}>{t("modalalbumcover.title")}</Title>}
      onClose={onRequestClose}
      size="lg"
    >
      <Stack gap="md">
        {albumTitle && (
          <Text c="dimmed" size="sm">
            {t("modalalbumcover.selectphoto", { album: albumTitle })}
          </Text>
        )}

        <Box className={classes.photoGrid}>
          <SimpleGrid cols={{ base: 3, xs: 4, sm: 5, md: 6 }} spacing="sm">
            {visiblePhotos.map(photo => (
              <UnstyledButton
                key={photo.id}
                onClick={() => handleSelectPhoto(photo.id)}
                className={classes.photoButton}
              >
                <Tile
                  className={classes.photoTile}
                  height={120}
                  width={120}
                  image_hash={photo.id}
                  video={photo.type === Media.VIDEO}
                />
              </UnstyledButton>
            ))}
          </SimpleGrid>
        </Box>

        <Group gap="xs" align="center" px="xs">
          <IconInfoCircle size={14} style={{ opacity: 0.7 }} />
          <Text size="xs" c="dimmed" style={{ flex: 1 }}>
            {t("modalalbumcover.tip")}
          </Text>
        </Group>

        {hasMore && (
          <Group justify="center">
            <Button variant="light" onClick={handleLoadMore} leftSection={<IconPhoto size={16} />}>
              {t("modalalbumcover.loadmore", { count: Math.min(PHOTOS_PER_PAGE, remainingCount) })}
            </Button>
            <Text size="xs" c="dimmed">
              {t("modalalbumcover.showing", { visible: visibleCount, total: photos.length })}
            </Text>
          </Group>
        )}

        {photos.length === 0 && (
          <Group justify="center" py="xl">
            <Text c="dimmed">{t("modalalbumcover.nophotos")}</Text>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
