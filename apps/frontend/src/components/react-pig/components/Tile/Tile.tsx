import { DateTime } from "luxon";
import { motion } from "motion/react";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parsePhotoTimestamp } from "../../../../util/dateUtils";
import type { ImageItem, LaidOutTile, PigOverlay, PigSettings, ScrollSpeed } from "../../types";
import getImageHeight from "../../utils/getImageHeight";
import getTileMeasurements from "../../utils/getTileMeasurements";
import styles from "./styles.module.css";

// Removing a <video> frees neither its media player nor the fetch in flight, so
// scrolling a large video library exhausts the browser's media element budget.
function useReleaseOnDetach() {
  const node = useRef<HTMLVideoElement | null>(null);
  return useCallback((element: HTMLVideoElement | null) => {
    if (element) {
      node.current = element;
      return;
    }
    const video = node.current;
    node.current = null;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }, []);
}

export type TileProps<T extends ImageItem> = {
  item: LaidOutTile<T>;
  useLqip: boolean;
  containerWidth: number;
  /** Null until Pig has measured its container. */
  containerOffsetTop: number | null;
  getUrl: (url: string, size: number) => string;
  activeTileUrl: string | null;
  handleClick: (event: React.MouseEvent<HTMLButtonElement>, item: T) => void;
  handleSelection: (item: T) => void;
  selected: boolean;
  selectable: boolean;
  windowHeight: number;
  scrollSpeed: ScrollSpeed;
  settings: Pick<PigSettings, "gridGap" | "bgColor" | "thumbnailSize" | "expandedSize">;
  toprightoverlay?: PigOverlay<T> | null;
  bottomleftoverlay?: PigOverlay<T> | null;
  bottomrightoverlay?: PigOverlay<T> | null;
};

const springTransition = { type: "spring", mass: 1.5, stiffness: 400, damping: 40 } as const;

function TileComponent<T extends ImageItem>({
  item,
  useLqip,
  containerWidth,
  containerOffsetTop,
  getUrl,
  activeTileUrl,
  handleClick,
  handleSelection,
  selected,
  selectable,
  windowHeight,
  scrollSpeed,
  settings,
  toprightoverlay = null,
  bottomleftoverlay = null,
  bottomrightoverlay = null,
}: TileProps<T>) {
  const { t, i18n } = useTranslation();
  const isTemp = !!item.isTemp;
  // A placeholder has no address yet; a loaded tile always has one.
  const url = item.url ?? "";
  const isSelectable = selectable;
  const isSelected = selected;
  const isExpanded = activeTileUrl === item.url;
  const isVideo =
    !isTemp &&
    (url.includes(".mp4") || url.includes(".mov") || (item.type !== undefined && item.type.includes("video")));
  const [isFullSizeLoaded, setFullSizeLoaded] = useState(!!isVideo);
  const [videoFailed, setVideoFailed] = useState(false);
  const gridVideoRef = useReleaseOnDetach();
  const expandedVideoRef = useReleaseOnDetach();

  const TopRightOverlay = toprightoverlay;
  const BottomLeftOverlay = bottomleftoverlay;
  const BottomRightOverlay = bottomrightoverlay;

  const { calcWidth, calcHeight, offsetX, offsetY } = getTileMeasurements({
    item,
    windowHeight,
    settings,
    containerWidth,
    containerOffsetTop,
  });

  function getWidth(exp: boolean, sel: boolean) {
    if (exp) {
      return `${Math.ceil(calcWidth)}px`;
    }
    if (sel) {
      return `${item.style.width - item.style.width * 0.1}px`;
    }
    return `${item.style.width}px`;
  }

  function getHeight(exp: boolean, sel: boolean) {
    if (exp) {
      return `${Math.ceil(calcHeight)}px`;
    }
    if (sel) {
      return `${item.style.height - item.style.height * 0.1}px`;
    }
    return `${item.style.height}px`;
  }

  // Every image in the tile is decorative (alt=""), so the button itself says
  // what it opens: the kind of media and, when known, when it was taken.
  const language = i18n.resolvedLanguage;
  const label = useMemo(() => {
    // exif_timestamp is the camera's wall clock tagged as UTC: read it in UTC.
    const taken = item.date ? parsePhotoTimestamp(item.date) : null;
    const date = taken?.isValid
      ? taken.setLocale((language ?? "en").replace("_", "-")).toLocaleString(DateTime.DATETIME_MED)
      : null;
    // The HDR badge is hidden from assistive tech, so the label says it.
    if (isVideo && item.is_hdr) return date ? t("phototile.hdrvideotaken", { date }) : t("phototile.hdrvideolabel");
    if (isVideo) return date ? t("phototile.videotaken", { date }) : t("phototile.video");
    return date ? t("phototile.phototaken", { date }) : t("phototile.photo");
  }, [item.date, item.is_hdr, isVideo, language, t]);

  // The wrapper carries the position and animation; the button and the
  // selection checkbox sit side by side in it, because a checkbox inside a
  // button is invalid interactive nesting that assistive tech cannot reach.
  return (
    <motion.div
      className={styles.pigTile}
      initial={false}
      animate={{
        width: getWidth(isExpanded, isSelected),
        height: getHeight(isExpanded, isSelected),
        zIndex: isExpanded ? 10 : 0,
        marginLeft: isSelected && !isExpanded ? item.style.width * 0.05 : 0,
        marginRight: isSelected && !isExpanded ? item.style.width * 0.05 : 0,
        marginTop: isSelected && !isExpanded ? item.style.height * 0.05 : 0,
        marginBottom: isSelected && !isExpanded ? item.style.height * 0.05 : 0,
        x: isExpanded ? offsetX : item.style.translateX,
        y: isExpanded ? offsetY : item.style.translateY,
      }}
      transition={springTransition}
      style={{
        outline: isExpanded ? `${settings.gridGap}px solid ${settings.bgColor}` : undefined,
        // Videos (and placeholders) have no dominant colour: a neutral fill
        // instead of a see-through hole while they load.
        backgroundColor: item.dominantColor || "var(--mantine-color-default-hover)",
        position: "absolute",
        left: 0,
        top: 0,
      }}
    >
      <button
        type="button"
        className={`${styles.pigBtn}${isExpanded ? ` ${styles.pigBtnActive}` : ""} pig-btn`}
        onClick={event => handleClick(event, item)}
        aria-label={label}
      >
        {useLqip && !isTemp && !isVideo && (
          // LQIP
          <img
            className={`${styles.pigImg} ${styles.pigThumbnail}${
              isFullSizeLoaded ? ` ${styles.pigThumbnailLoaded}` : ""
            }`}
            src={getUrl(url, settings.thumbnailSize)}
            loading="lazy"
            width={item.style.width}
            height={item.style.height}
            alt=""
          />
        )}

        {scrollSpeed === "slow" && !isVideo && !isTemp && (
          // grid image
          <img
            className={`${styles.pigImg} ${styles.pigFull}${isFullSizeLoaded ? ` ${styles.pigFullLoaded}` : ""}`}
            src={getUrl(url, getImageHeight(containerWidth))}
            alt=""
            onLoad={() => {
              setFullSizeLoaded(true);
              // Force a re-render to ensure the blur filter is removed
              setTimeout(() => {
                // Grid videos carry the thumbnail class too.
                const thumbnails = document.querySelectorAll(`.${styles.pigThumbnail}`);
                thumbnails.forEach(thumbnail => {
                  if (
                    (thumbnail instanceof HTMLImageElement || thumbnail instanceof HTMLMediaElement) &&
                    thumbnail.src.includes(url.split(";")[0])
                  ) {
                    thumbnail.classList.add(styles.pigThumbnailLoaded);
                  }
                });
              }, 50);
            }}
          />
        )}

        {scrollSpeed === "slow" && isVideo && !isTemp && !videoFailed && (
          <video
            ref={gridVideoRef}
            className={`${styles.pigImg} ${styles.pigThumbnail}${
              isFullSizeLoaded ? ` ${styles.pigThumbnailLoaded}` : ""
            }`}
            src={getUrl(url, getImageHeight(containerWidth))}
            preload="metadata"
            onCanPlay={() => setFullSizeLoaded(true)}
            onMouseOver={event => event.currentTarget.play()}
            onFocus={event => event.currentTarget.play()}
            onMouseOut={event => event.currentTarget.pause()}
            onBlur={event => event.currentTarget.pause()}
            onError={() => setVideoFailed(true)}
            muted
            loop
            playsInline
          />
        )}

        {isExpanded && !isVideo && !isTemp && (
          // full size expanded image
          <img className={styles.pigImg} src={getUrl(url, settings.expandedSize)} alt="" />
        )}

        {isExpanded && isVideo && !isTemp && !videoFailed && (
          // full size expanded video
          <video
            ref={expandedVideoRef}
            className={styles.pigImg}
            src={getUrl(url, settings.expandedSize)}
            preload="metadata"
            onMouseOver={event => event.currentTarget.play()}
            onFocus={event => event.currentTarget.play()}
            onMouseOut={event => event.currentTarget.pause()}
            onBlur={event => event.currentTarget.pause()}
            onError={() => setVideoFailed(true)}
            muted
            loop
            playsInline
          />
        )}

        <div>
          <div className={styles.overlaysTopRight}>{TopRightOverlay && <TopRightOverlay item={item} />}</div>
          <div className={styles.overlaysBottomLeft}>{BottomLeftOverlay && <BottomLeftOverlay item={item} />}</div>
          <div className={styles.overlaysBottomRight}>{BottomRightOverlay && <BottomRightOverlay item={item} />}</div>
        </div>
      </button>
      {isSelectable && (
        <div className={styles.overlaysTopLeft}>
          <input
            key={`checkbox-${item.id}-${isSelected}`}
            type="checkbox"
            className={styles.checkbox}
            defaultChecked={isSelected}
            aria-label={t("phototile.select", { name: label })}
            onClick={event => {
              event.stopPropagation();
              handleSelection(item);
            }}
          />
        </div>
      )}
    </motion.div>
  );
}

// React.memo keeps the props type of the component it wraps but not its type
// parameter; this gives it back, so a tile's callbacks get the caller's item type.
// It is true at runtime: memo hands the props to TileComponent unchanged.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- generic memo, see above
const Tile = React.memo(TileComponent) as <T extends ImageItem>(props: TileProps<T>) => React.ReactNode;

export default Tile;
