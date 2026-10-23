import type { PigPhoto } from "@librephotos/api-client";
import { Button, Checkbox, Group, Modal, SimpleGrid, Stack, Text } from "@mantine/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePersonSharingPendingQuery, useReviewPersonSharingMutation } from "../../api_client/albums/hooks";
import { parsePhotoTimestamp } from "../../util/dateUtils";
import { PageLoader } from "../common/PageLoader";
import { Tile } from "../Tile";

type Props = Readonly<{
  opened: boolean;
  onClose: () => void;
  person: Readonly<{ id: number | string; name: string }>;
}>;

/** The tick box's name: which photo, by when it was taken. */
function photoLabel(t: ReturnType<typeof useTranslation>["t"], photo: PigPhoto): string {
  if (!photo.date) return t("personshare.photoNoDate");
  return t("personshare.photoLabel", { date: parsePhotoTimestamp(photo.date).toLocaleString() });
}

/**
 * The photos labelled with a shared person since it was shared (#668), which its recipients do not
 * see yet: one page of them (the server's page size), each ticked; the ticked ones are shared, the
 * others kept back for good.
 */
export function PersonShareReviewModal({ opened, onClose, person }: Props) {
  const { t } = useTranslation();
  const { data: page } = usePersonSharingPendingQuery(Number(person.id), opened);
  const review = useReviewPersonSharingMutation(Number(person.id));
  // The ids the owner unticked; everything else on the page is shared.
  const [keptBack, setKeptBack] = useState<ReadonlySet<string>>(new Set());
  const photos = page?.results ?? [];
  const shared = photos.filter(photo => !keptBack.has(photo.id));
  const toggle = (id: string, share: boolean) =>
    setKeptBack(previous => {
      const next = new Set(previous);
      if (share) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () =>
    review.mutate(
      { approve: shared.map(photo => photo.id), decline: [...keptBack] },
      {
        onSuccess: () => {
          setKeptBack(new Set());
          onClose();
        },
      }
    );

  return (
    <Modal opened={opened} onClose={onClose} size="lg" title={t("personshare.reviewTitle", { name: person.name })}>
      {page ? (
        <Stack>
          <Text size="sm">{t("personshare.reviewIntro", { name: person.name })}</Text>
          <SimpleGrid cols={{ base: 3, xs: 4 }} spacing="xs">
            {photos.map(photo => (
              <Stack key={photo.id} gap={4} align="center">
                <Tile width={96} height={96} image_hash={photo.image_hash} video={photo.type === "video"} />
                <Checkbox
                  aria-label={photoLabel(t, photo)}
                  checked={!keptBack.has(photo.id)}
                  onChange={event => toggle(photo.id, event.currentTarget.checked)}
                />
              </Stack>
            ))}
          </SimpleGrid>
          {page.count > photos.length && (
            <Text size="xs" c="dimmed">
              {t("personshare.moreLater", { count: page.count - photos.length })}
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t("collab.cancel")}
            </Button>
            <Button loading={review.isPending} onClick={submit}>
              {t("personshare.shareChecked", { count: shared.length })}
            </Button>
          </Group>
        </Stack>
      ) : (
        <PageLoader />
      )}
    </Modal>
  );
}
