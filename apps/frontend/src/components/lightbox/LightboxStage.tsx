import { ActionIcon } from "@mantine/core";
import { IconChevronLeft as ChevronLeft, IconChevronRight as ChevronRight } from "@tabler/icons-react";
import React, { useRef } from "react";
import { useTranslation } from "react-i18next";
import classes from "./LightboxStage.module.css";
import { SlideTransition } from "./SlideTransition";
import { useLightboxGestures } from "./useLightboxGestures";
import type { LightboxZoom } from "./useLightboxZoom";

type Props = Readonly<{
  mainSrc: string;
  nextSrc: string | null;
  prevSrc: string | null;
  onMoveNextRequest: () => void;
  onMovePrevRequest: () => void;
  zoom: LightboxZoom;
  gesturesEnabled: boolean;
  zoomable: boolean;
  quarterTurned: boolean;
  previous: React.ReactNode;
  main: React.ReactNode;
  next: React.ReactNode;
}>;

export function LightboxStage(props: Props) {
  const { t } = useTranslation();
  const media = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const mainSlide = useRef<HTMLDivElement>(null);
  const { swipedTo } = useLightboxGestures({
    mainSrc: props.mainSrc,
    media,
    track,
    mainSlide,
    zoom: props.zoom,
    enabled: props.gesturesEnabled,
    zoomable: props.zoomable,
    quarterTurned: props.quarterTurned,
    nextSrc: props.nextSrc,
    prevSrc: props.prevSrc,
    onMoveNextRequest: props.onMoveNextRequest,
    onMovePrevRequest: props.onMovePrevRequest,
  });

  return (
    <>
      <div ref={media} className={classes.media} data-lightbox-media data-gestures={props.gesturesEnabled || undefined}>
        <div ref={track} className={classes.track}>
          <div className={classes.slide} aria-hidden inert>
            {props.previous}
          </div>
          <div ref={mainSlide} className={classes.slide}>
            <SlideTransition slideKey={props.mainSrc} fade={swipedTo !== props.mainSrc}>
              {props.main}
            </SlideTransition>
          </div>
          <div className={classes.slide} aria-hidden inert>
            {props.next}
          </div>
        </div>
      </div>
      {props.prevSrc && (
        <ActionIcon
          className={`${classes.control} ${classes.previous}`}
          size={44}
          radius="xl"
          aria-label={t("lightbox.controls.previous")}
          onClick={props.onMovePrevRequest}
        >
          <ChevronLeft size={24} />
        </ActionIcon>
      )}
      {props.nextSrc && (
        <ActionIcon
          className={`${classes.control} ${classes.next}`}
          size={44}
          radius="xl"
          aria-label={t("lightbox.controls.next")}
          onClick={props.onMoveNextRequest}
        >
          <ChevronRight size={24} />
        </ActionIcon>
      )}
    </>
  );
}
