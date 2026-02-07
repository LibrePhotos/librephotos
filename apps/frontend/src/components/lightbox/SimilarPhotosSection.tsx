import { Anchor, Flex, Group, Title } from "@mantine/core";
import { IconPhoto as Photo } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { Photo as PhotoType } from "../../api_client/photos/types";
import { Tile } from "../Tile";

interface SimilarPhotosSectionProps {
  photoDetail: PhotoType;
  maxItems?: number;
  showTitle?: boolean;
}

export function SimilarPhotosSection({ photoDetail, maxItems = 8, showTitle = true }: SimilarPhotosSectionProps) {
  const { t } = useTranslation();

  if (!photoDetail.similar_photos || photoDetail.similar_photos.length === 0) return null;

  // Filter out the current photo from similar photos
  const filteredSimilarPhotos = photoDetail.similar_photos.filter(photo => photo.image_hash !== photoDetail.image_hash);

  if (filteredSimilarPhotos.length === 0) return null;

  return (
    <div>
      {showTitle && (
        <Group>
          <Photo />
          <Title order={4}>{t("lightbox.sidebar.similarphotos", "Similar Photos")}</Title>
        </Group>
      )}
      <Flex gap="xs" wrap="wrap" mt="xs">
        {filteredSimilarPhotos.slice(0, maxItems).map(el => (
          <Anchor
            key={el.image_hash}
            href={`/photo/${el.image_hash}`}
            style={{
              minWidth: "110px",
              maxWidth: "110px",
            }}
          >
            <Tile
              video={el.type.includes("video")}
              height={100}
              width={100}
              image_hash={el.image_hash}
              style={{
                objectFit: "cover",
                width: "100%",
                height: "100%",
                aspectRatio: "1",
                borderRadius: "4px",
                transition: "transform 0.2s ease",
              }}
            />
          </Anchor>
        ))}
      </Flex>
    </div>
  );
}
