import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ImageItem, LaidOutTile, PigOverlay, ScrollSpeed, TileUrl } from "../../types";
import styles from "./styles.module.css";
import { tileLabel } from "./tileLabel";
import { showsPoster, TileMedia } from "./TileMedia";
import { useClipPreview } from "./useClipPreview";

type TileProps<T extends ImageItem> = {
  item: LaidOutTile<T>;
  containerWidth: number;
  getUrl: TileUrl;
  handleClick: (event: React.MouseEvent<HTMLButtonElement>, item: T) => void;
  handleSelection: (item: T) => void;
  selected: boolean;
  selectable: boolean;
  scrollSpeed: ScrollSpeed;
  toprightoverlay?: PigOverlay<T> | null;
  bottomleftoverlay?: PigOverlay<T> | null;
  bottomrightoverlay?: PigOverlay<T> | null;
};

function TileComponent<T extends ImageItem>({
  item,
  containerWidth,
  getUrl,
  handleClick,
  handleSelection,
  selected,
  selectable,
  scrollSpeed,
  toprightoverlay = null,
  bottomleftoverlay = null,
  bottomrightoverlay = null,
}: TileProps<T>) {
  const { t } = useTranslation();
  const isTemp = !!item.isTemp;
  const isSelectable = selectable;
  const isSelected = selected;
  const isVideo = !isTemp && item.type !== undefined && item.type.includes("video");
  // A video with a poster mounts its clip only while it is pointed at or focused (#2026).
  const { previewing, handlers: previewHandlers } = useClipPreview(showsPoster(item));

  const TopRightOverlay = toprightoverlay;
  const BottomLeftOverlay = bottomleftoverlay;
  const BottomRightOverlay = bottomrightoverlay;

  const label = useMemo(() => tileLabel(item, isVideo, t), [item, isVideo, t]);

  // The wrapper carries the place the layout gave the tile; the button and the
  // selection checkbox sit side by side in it, because a checkbox inside a
  // button is invalid interactive nesting that assistive tech cannot reach.
  // A new layout (a day's page arrived, the width changed) moves the tile at
  // once: the grid keeps the reader's place by scrolling in the same frame.
  // A selected tile keeps its cell: the photo inside it shrinks onto a tinted
  // cell (styles.module.css), as in Google Photos, so neighbours never move.
  return (
    <div
      className={styles.pigTile}
      {...previewHandlers}
      style={{
        width: `${item.style.width}px`,
        height: `${item.style.height}px`,
        transform: `translate(${item.style.translateX}px, ${item.style.translateY}px)`,
        // Videos (and placeholders) have no dominant colour: a neutral fill
        // instead of a see-through hole while they load.
        backgroundColor: item.dominantColor || "var(--mantine-color-default-hover)",
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
          containerWidth={containerWidth}
          scrollSpeed={scrollSpeed}
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
    </div>
  );
}

// React.memo keeps the props type of the component it wraps but not its type
// parameter; this gives it back, so a tile's callbacks get the caller's item type.
// It is true at runtime: memo hands the props to TileComponent unchanged.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- generic memo, see above
const Tile = React.memo(TileComponent) as <T extends ImageItem>(props: TileProps<T>) => React.ReactNode;

export default Tile;
