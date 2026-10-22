import { motion } from "motion/react";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ImageItem, LaidOutTile, PigOverlay, PigSettings, ScrollSpeed, TileUrl } from "../../types";
import getTileMeasurements from "../../utils/getTileMeasurements";
import styles from "./styles.module.css";
import { tileLabel } from "./tileLabel";
import { showsPoster, TileMedia } from "./TileMedia";
import { useClipPreview } from "./useClipPreview";

type TileProps<T extends ImageItem> = {
  item: LaidOutTile<T>;
  useLqip: boolean;
  containerWidth: number;
  /** Null until Pig has measured its container. */
  containerOffsetTop: number | null;
  getUrl: TileUrl;
  /** The id of the tile expanded in place, if any. */
  activeTileId: ImageItem["id"] | null;
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
  activeTileId,
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
  const { t } = useTranslation();
  const isTemp = !!item.isTemp;
  const isSelectable = selectable;
  const isSelected = selected;
  const isExpanded = activeTileId !== null && activeTileId === item.id;
  const isVideo = !isTemp && item.type !== undefined && item.type.includes("video");
  // A video with a poster mounts its clip only while it is pointed at or focused (#2026).
  const { previewing, handlers: previewHandlers } = useClipPreview(showsPoster(item));

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

  const label = useMemo(() => tileLabel(item, isVideo, t), [item, isVideo, t]);

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
      {...previewHandlers}
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
        className={`${styles.pigBtn} pig-btn`}
        onClick={event => handleClick(event, item)}
        aria-label={label}
      >
        <TileMedia
          item={item}
          getUrl={getUrl}
          useLqip={useLqip}
          containerWidth={containerWidth}
          scrollSpeed={scrollSpeed}
          settings={settings}
          isExpanded={isExpanded}
          previewing={previewing}
        />

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
