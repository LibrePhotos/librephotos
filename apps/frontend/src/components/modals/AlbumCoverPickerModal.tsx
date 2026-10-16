import type { PigPhoto } from "@librephotos/api-client";
import { Media } from "@librephotos/api-client";
import { Box, Button, Group, Modal, SimpleGrid, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconCheck, IconInfoCircle, IconPhoto, IconSparkles } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tile } from "../Tile";
import classes from "./AlbumCoverPickerModal.module.css";
import { modalTitleStyles } from "./modalTitleStyles";

const PHOTOS_PER_PAGE = 50;

type Props = Readonly<{
  isOpen: boolean;
  onRequestClose: () => void;
  photos: PigPhoto[];
  onSelectCover: (photoId: string) => void;
  albumTitle?: string;
  /** The photo id of the cover in use, marked in the grid; null while it is automatic. */
  currentCoverId?: string | null;
  /** Offer an "Automatic" choice first (an event's first photo, #429), which calls this. */
  onSelectAutomatic?: () => void;
}>;

/** The check on the cell of the cover in use. */
function SelectedMark() {
  return (
    <span className={classes.selectedMark} aria-hidden>
      <IconCheck size={12} stroke={3} />
    </span>
  );
}

export function AlbumCoverPickerModal({
  isOpen,
  onRequestClose,
  photos,
  onSelectCover,
  albumTitle,
  currentCoverId,
  onSelectAutomatic,
}: Props) {
  const { t } = useTranslation();
  const [visibleCount, setVisibleCount] = useState(PHOTOS_PER_PAGE);

  const handleSelectPhoto = (photoId: string) => {
    onSelectCover(photoId);
    onRequestClose();
  };

  const handleSelectAutomatic = () => {
    onSelectAutomatic?.();
    onRequestClose();
  };
  const automaticSelected = !currentCoverId;

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
      styles={modalTitleStyles}
      zIndex={1500}
      opened={isOpen}
      title={t("modalalbumcover.title")}
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
            {onSelectAutomatic && (
              <UnstyledButton
                onClick={handleSelectAutomatic}
                className={classes.automaticButton}
                data-selected={automaticSelected || undefined}
                aria-pressed={automaticSelected}
              >
                <Stack gap={2} align="center">
                  <IconSparkles size={20} aria-hidden />
                  <Text size="xs" fw={600}>
                    {t("modalalbumcover.automatic")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("modalalbumcover.automatichint")}
                  </Text>
                </Stack>
                {automaticSelected && <SelectedMark />}
              </UnstyledButton>
            )}
            {visiblePhotos.map((photo, index) => {
              const selected = photo.id === currentCoverId;
              return (
                <UnstyledButton
                  key={photo.id}
                  onClick={() => handleSelectPhoto(photo.id)}
                  className={classes.photoButton}
                  data-selected={selected || undefined}
                  aria-pressed={currentCoverId === undefined ? undefined : selected}
                >
                  <Tile
                    className={classes.photoTile}
                    height={120}
                    width={120}
                    image_hash={photo.id}
                    video={photo.type === Media.VIDEO}
                    alt={t("photoofcount", { index: index + 1, count: photos.length })}
                  />
                  {selected && <SelectedMark />}
                </UnstyledButton>
              );
            })}
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
