import { Box, Group, Skeleton, UnstyledButton } from "@mantine/core";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetchPhotoDetailsQuery } from "../../api_client/photos/hooks/useFetchPhotoDetailsQuery";
import { Tile } from "../Tile";
import { NEXT_KEY, PREVIOUS_KEY } from "./lightbox.hotkeys";
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

/** The thumbnail size: 56px, as in Google Photos' strip. */
const THUMB = 56;
/** How long the strip stays after the pointer stops or a key steps. */
const REVEAL_MS = 2500;

/** The keys that step to another photo: stepping shows where you are. */
const STEP_KEYS = new Set([PREVIOUS_KEY, NEXT_KEY]);

/**
 * Whether the strip shows: for a while after the pointer moves over the stage (the strip's parent)
 * or an arrow key steps, so a still photo has the whole stage. The strip's own :hover and
 * :focus-within keep it while it is used (the CSS module).
 */
function useReveal(stripRef: React.RefObject<HTMLDivElement | null>) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      setRevealed(true);
      clearTimeout(timer);
      timer = setTimeout(() => setRevealed(false), REVEAL_MS);
    };
    const onKey = (event: KeyboardEvent) => {
      if (STEP_KEYS.has(event.key)) reveal();
    };
    const stage = stripRef.current?.parentElement;
    stage?.addEventListener("pointermove", reveal, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      stage?.removeEventListener("pointermove", reveal);
      document.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [stripRef]);
  return revealed;
}

/**
 * The previous, current and next photos at the bottom of the lightbox, over the photo, shown only
 * while the pointer moves or the keys step (useReveal). Hidden on a touch screen and a phone, where
 * a swipe steps.
 */
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
  const stripRef = useRef<HTMLDivElement>(null);
  const revealed = useReveal(stripRef);
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
    <div ref={stripRef} className={classes.strip} data-revealed={revealed || undefined}>
      <Group justify="center" align="center" gap={4} wrap="nowrap">
        {prevSrc && (
          <UnstyledButton
            onClick={onMovePrevRequest}
            className={classes.neighbour}
            aria-label={t("lightbox.controls.previous")}
          >
            {isPrevPhotoDetailLoading ? (
              <Skeleton height={THUMB} width={THUMB} />
            ) : (
              <Tile
                image_hash={prevSrcHash || ""}
                width={THUMB}
                height={THUMB}
                video={prevPhotoDetail?.video}
                className={classes.tile}
              />
            )}
          </UnstyledButton>
        )}

        <Box className={classes.current}>
          {isMainPhotoDetailLoading ? (
            <Skeleton height={THUMB} width={THUMB} />
          ) : (
            <Tile
              image_hash={mainSrcHash}
              width={THUMB}
              height={THUMB}
              video={mainPhotoDetail?.video}
              className={classes.tile}
            />
          )}
        </Box>

        {nextSrc && (
          <UnstyledButton
            onClick={onMoveNextRequest}
            className={classes.neighbour}
            aria-label={t("lightbox.controls.next")}
          >
            {isNextPhotoDetailLoading ? (
              <Skeleton height={THUMB} width={THUMB} />
            ) : (
              <Tile
                image_hash={nextSrcHash || ""}
                width={THUMB}
                height={THUMB}
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
