import { Box, Button, Divider, Group, Modal, ScrollArea, SimpleGrid, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconArrowBackUp, IconCheck, IconX } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useDismissDuplicateMutation,
  useDuplicateQuery,
  useResolveDuplicateMutation,
  useRevertDuplicateMutation,
} from "../../api_client/duplicates";
import type { DuplicatePhoto } from "../../api_client/duplicates/types";
import { PageLoader } from "../common/PageLoader";
import { Lightbox } from "../lightbox";
import { DuplicatePhotoCard } from "./DuplicatePhotoCard";
import classes from "./DuplicatesPageContent.module.css";
import { getDuplicateTypeIcon } from "./duplicateTypeDisplay";

export function DuplicateModal({
  duplicateId,
  opened,
  onClose,
}: {
  duplicateId: string;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);
  const [lightboxImageHash, setLightboxImageHash] = useState<string | null>(null);
  const [lightboxOpened, { open: openLightbox, close: closeLightbox }] = useDisclosure(false);

  const { data: duplicate, isLoading } = useDuplicateQuery(duplicateId);
  const { mutate: resolveDuplicate, isPending: isResolving } = useResolveDuplicateMutation();
  const { mutate: dismissDuplicate, isPending: isDismissing } = useDismissDuplicateMutation();
  const { mutate: revertDuplicate, isPending: isReverting } = useRevertDuplicateMutation();

  const isResolved = duplicate?.review_status === "resolved";
  const isDismissed = duplicate?.review_status === "dismissed";
  const isReviewed = isResolved || isDismissed;

  // Create idx2hash array for the Lightbox component
  const idx2hash = React.useMemo(() => {
    if (!duplicate?.photos || duplicate.photos.length === 0) return [];
    return duplicate.photos.map(p => ({ id: p.id, image_hash: p.image_hash }));
  }, [duplicate?.photos]);

  const handleViewFull = (photo: DuplicatePhoto) => {
    setLightboxImageHash(photo.image_hash);
    openLightbox();
  };

  const handleResolve = () => {
    if (selectedPhoto) {
      resolveDuplicate(
        { id: duplicateId, keep_photo_hash: selectedPhoto, trash_others: true },
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
    dismissDuplicate(duplicateId, {
      onSuccess: () => {
        onClose();
        setSelectedPhoto(null);
      },
    });
  };

  const handleRevert = () => {
    revertDuplicate(duplicateId, {
      onSuccess: () => {
        onClose();
        setSelectedPhoto(null);
      },
    });
  };

  // Auto-select highest resolution photo when duplicate loads
  React.useEffect(() => {
    if (duplicate?.photos && duplicate.photos.length > 0 && !selectedPhoto) {
      // First try kept photo
      const kept = duplicate.photos.find(p => p.is_kept);
      if (kept) {
        setSelectedPhoto(kept.image_hash);
        return;
      }
      // Otherwise pick best by resolution then size
      const best = [...duplicate.photos].sort((a, b) => {
        const aRes = (a.width || 0) * (a.height || 0);
        const bRes = (b.width || 0) * (b.height || 0);
        if (aRes !== bRes) return bRes - aRes;
        return b.size - a.size;
      })[0];
      if (best !== undefined) {
        setSelectedPhoto(best.image_hash);
      }
    }
  }, [duplicate, selectedPhoto]);

  const getDuplicateDescription = () => {
    if (!duplicate) return "";
    switch (duplicate.duplicate_type) {
      case "exact_copy":
        return t("duplicates.desc.exact_copy");
      case "visual_duplicate":
        return t("duplicates.desc.visual_duplicate");
      default:
        return "";
    }
  };

  return (
    <>
      {lightboxOpened && lightboxImageHash && (
        <Lightbox
          isPublic={false}
          idx2hash={idx2hash}
          selectedImage={lightboxImageHash}
          onCloseRequest={closeLightbox}
          onChangedIndex={() => {}}
        />
      )}
      <Modal
        opened={opened}
        onClose={onClose}
        title={
          // A span, not a Group (a div): Mantine's title is an <h2>, which takes phrasing
          // content only. The 18px icon matches the theme's title text.
          <Box component="span" className={classes.title}>
            {duplicate && getDuplicateTypeIcon(duplicate.duplicate_type, 18)}
            {/* Plain text, styled by the app's Modal theme */}
            {duplicate ? t(`duplicates.types.${duplicate.duplicate_type}`) : t("duplicates.review")}
          </Box>
        }
        size="90%"
        centered
        styles={{
          body: { maxHeight: "80vh", display: "flex", flexDirection: "column" },
        }}
      >
        {isLoading ? (
          <PageLoader label={t("duplicates.loading")} />
        ) : duplicate ? (
          <Stack flex={1} mih="0">
            <Text size="sm" c="dimmed">
              {getDuplicateDescription()}
              {/* !! so a score of 0 does not render a stray "0" */}
              {!!duplicate.similarity_score && (
                <Text span size="sm" c="blue" ml="xs">
                  {t("duplicates.similarpercent", {
                    percent: Math.round(duplicate.similarity_score * 100),
                  })}
                </Text>
              )}
            </Text>

            {!isReviewed && (
              <Text size="sm" c="dimmed">
                {t("duplicates.selectbest")}
              </Text>
            )}

            {isResolved && (
              <Text size="sm" c="dimmed">
                {t("duplicates.resolvedInfo")}{" "}
                <Text span size="sm" c="blue">
                  {t("duplicates.revertInfo")}
                </Text>
              </Text>
            )}

            {/* Dismissing unlinks the photos and the backend only reverts resolved groups, so no revert here */}
            {isDismissed && (
              <Text size="sm" c="dimmed">
                {t("duplicates.dismissedInfo")}
              </Text>
            )}

            <ScrollArea flex={1} offsetScrollbars>
              <SimpleGrid cols={{ base: 1, sm: 2, md: duplicate.photos.length > 2 ? 3 : 2 }} spacing="md" p="xs">
                {duplicate.photos.map(photo => (
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
                  {t("close")}
                </Button>
                {isResolved && (
                  <Button
                    color="blue"
                    leftSection={<IconArrowBackUp size={16} />}
                    onClick={handleRevert}
                    loading={isReverting}
                  >
                    {t("duplicates.revert")}
                  </Button>
                )}
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
                  {t("duplicates.notduplicates")}
                </Button>

                <Group>
                  <Button variant="outline" onClick={onClose}>
                    {t("cancel")}
                  </Button>
                  <Button
                    color="blue"
                    leftSection={<IconCheck size={16} />}
                    onClick={handleResolve}
                    loading={isResolving}
                    disabled={!selectedPhoto}
                  >
                    {t("duplicates.keepandtrash")}
                  </Button>
                </Group>
              </Group>
            )}
          </Stack>
        ) : (
          <Text c="red">{t("duplicates.error")}</Text>
        )}
      </Modal>
    </>
  );
}
