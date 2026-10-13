import { Box, Group, Skeleton, UnstyledButton } from "@mantine/core";
import cx from "clsx";
import React from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks/useFetchPhotoDetailsQuery";
import { Tile } from "../Tile";
import classes from "./ThumbnailNavigation.module.css";

export type ThumbnailNavigationProps = {
  prevSrc: string | null;
  prevSrcHash: string | null;
  mainSrcHash: string;
  nextSrc: string | null;
  nextSrcHash: string | null;
  onMovePrevRequest: () => void;
  onMoveNextRequest: () => void;
  isPublic?: boolean;
};

export function ThumbnailNavigation({
  prevSrc,
  prevSrcHash,
  mainSrcHash,
  nextSrc,
  nextSrcHash,
  onMovePrevRequest,
  onMoveNextRequest,
  isPublic = false,
}: ThumbnailNavigationProps) {
  const { t } = useTranslation();
  // Use image_hash for API calls since backend still uses image_hash for lookup
  // Skip these queries on public pages
  const { data: prevPhotoDetail, isLoading: isPrevPhotoDetailLoading } = useFetchPhotoDetailsQuery(
    prevSrcHash ?? "",
    isPublic
  );
  const { data: mainPhotoDetail, isLoading: isMainPhotoDetailLoading } = useFetchPhotoDetailsQuery(
    mainSrcHash,
    isPublic
  );
  const { data: nextPhotoDetail, isLoading: isNextPhotoDetailLoading } = useFetchPhotoDetailsQuery(
    nextSrcHash ?? "",
    isPublic
  );

  return (
    <div className={classes.strip}>
      <Group justify="center" align="center" h="100%">
        {prevSrc && (
          <UnstyledButton
            onClick={onMovePrevRequest}
            className={cx(classes.neighbour, classes.previous)}
            aria-label={t("lightbox.controls.previous")}
          >
            {isPrevPhotoDetailLoading ? (
              <Skeleton height={64} width={64} />
            ) : (
              <Tile
                image_hash={prevSrcHash || ""}
                width={64}
                height={64}
                video={prevPhotoDetail?.video}
                className={classes.tile}
              />
            )}
          </UnstyledButton>
        )}

        <Box className={classes.current}>
          {isMainPhotoDetailLoading ? (
            <Skeleton height={72} width={72} />
          ) : (
            <Tile
              image_hash={mainSrcHash}
              width={72}
              height={72}
              video={mainPhotoDetail?.video}
              className={classes.tile}
            />
          )}
        </Box>

        {nextSrc && (
          <UnstyledButton
            onClick={onMoveNextRequest}
            className={cx(classes.neighbour, classes.next)}
            aria-label={t("lightbox.controls.next")}
          >
            {isNextPhotoDetailLoading ? (
              <Skeleton height={64} width={64} />
            ) : (
              <Tile
                image_hash={nextSrcHash || ""}
                width={64}
                height={64}
                video={nextPhotoDetail?.video}
                className={classes.tile}
              />
            )}
          </UnstyledButton>
        )}
      </Group>
    </div>
  );
}
