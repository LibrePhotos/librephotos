import { Anchor, Grid, Group, Title } from "@mantine/core";
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

export function SimilarPhotosSection({ 
  photoDetail, 
  maxItems = 8, 
  showTitle = true 
}: SimilarPhotosSectionProps) {
  const { t } = useTranslation();
  
  if (!photoDetail.similar_photos || photoDetail.similar_photos.length === 0) return null;

  return (
    <div>
      {showTitle && (
        <Group>
          <Photo />
          <Title order={4}>{t("lightbox.sidebar.similarphotos", "Similar Photos")}</Title>
        </Group>
      )}
      <Grid gutter="xs" mt="xs">
        {photoDetail.similar_photos.slice(0, maxItems).map(el => (
          <Grid.Col key={el.image_hash} span={3}>
            <Anchor href={`/photo/${el.image_hash}`}>
              <Tile 
                video={el.type.includes("video")} 
                height={80} 
                width={120} 
                image_hash={el.image_hash} 
              />
            </Anchor>
          </Grid.Col>
        ))}
      </Grid>
    </div>
  );
} 