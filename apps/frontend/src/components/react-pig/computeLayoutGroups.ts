// like computeLayout but specific for groups. Could combine them but it might get messy
import type { GroupedImageItem, ImageItem, LaidOutGroup, LaidOutTile, PigSettings } from "./types";
import getMinAspectRatio from "./utils/getMinAspectRatio";

type ComputeLayoutGroupsParams<T extends ImageItem> = {
  imageData: readonly GroupedImageItem<T>[];
  settings: Pick<PigSettings, "gridGap" | "headerSize" | "breakpoint" | "groupGapSm" | "groupGapLg">;
  wrapperWidth: number;
  scaleOfImages: number;
};

// A day whose photos fit on one line at the target row height shares that line with the days next
// to it while they fit (each under its own header), as in Immich, instead of leaving the rest of the
// line empty. Longer days get justified rows of their own.
// The space between two days on one line, and the least width a day takes there so its header fits.
const INLINE_GROUP_GAP = 24;
const INLINE_GROUP_MIN_WIDTH = 170;

type Settings = ComputeLayoutGroupsParams<ImageItem>["settings"];

function groupTitleHeightFor(settings: Settings, wrapperWidth: number): number {
  const narrow = wrapperWidth < settings.breakpoint;
  if (settings.headerSize === "small") return narrow ? 25 : 30; // Small headers are more compact
  if (settings.headerSize === "normal") return narrow ? 35 : 40; // Normal headers are medium
  return narrow ? 45 : 50; // Large headers are full size
}

function groupGapFor(settings: Settings, wrapperWidth: number): number {
  // More compact spacing with smaller headers
  if (settings.headerSize === "small") return 5;
  if (settings.headerSize === "normal") return 20;
  return wrapperWidth < settings.breakpoint ? settings.groupGapSm : settings.groupGapLg;
}

/** Justified rows of a whole-width group whose first row starts at `top`; returns the rows' height. */
function layOutRows<T extends ImageItem>(
  items: readonly T[],
  top: number,
  wrapperWidth: number,
  minAspectRatio: number,
  gridGap: number,
  out: LaidOutTile<T>[]
): number {
  let row: T[] = [];
  let rowAspectRatio = 0;
  let height = 0;
  items.forEach((image, index) => {
    row.push(image);
    rowAspectRatio += image.aspectRatio;
    // When the row's aspect ratio reaches the minimum, or the images run out, the row is complete.
    if (rowAspectRatio < minAspectRatio && index + 1 < items.length) return;
    const totalDesiredWidthOfImages = wrapperWidth - gridGap * (row.length - 1);
    // A last row too short to fill the width keeps the target height instead of growing.
    const rowHeight = totalDesiredWidthOfImages / Math.max(rowAspectRatio, minAspectRatio);
    let translateX = 0;
    row.forEach(img => {
      const imageWidth = rowHeight * img.aspectRatio;
      out.push({ ...img, style: { width: imageWidth, height: rowHeight, translateX, translateY: top + height } });
      translateX += Math.round(imageWidth + gridGap);
    });
    row = [];
    rowAspectRatio = 0;
    height += Math.round(rowHeight + gridGap);
  });
  return height;
}

export default function computeLayoutGroups<T extends ImageItem>({
  imageData,
  settings,
  wrapperWidth,
  scaleOfImages,
}: ComputeLayoutGroupsParams<T>): { imageData: LaidOutGroup<T>[]; newTotalHeight: number } {
  // The minimum aspect ratio of a row; a lone row at it is the target row height.
  const minAspectRatio = getMinAspectRatio(wrapperWidth, scaleOfImages);
  const targetRowHeight = wrapperWidth / minAspectRatio;
  const groupTitleHeight = groupTitleHeightFor(settings, wrapperWidth);
  const groupGap = groupGapFor(settings, wrapperWidth);
  const { gridGap } = settings;

  const groups: LaidOutGroup<T>[] = [];
  // The top of the next group's header.
  let top = 0;
  // The open line of short groups: its right edge so far, or null when there is none.
  let lineRight: number | null = null;
  const closeLine = () => {
    if (lineRight === null) return;
    top += groupTitleHeight + Math.round(targetRowHeight + gridGap) + groupGap;
    lineRight = null;
  };

  imageData.forEach(g => {
    // Skip empty groups (and an entry from untyped data whose `items` is unset)
    if (!g.items || g.items.length === 0) return;

    const aspectRatioSum = g.items.reduce((sum, item) => sum + item.aspectRatio, 0);
    const shortWidth = aspectRatioSum * targetRowHeight + gridGap * (g.items.length - 1);
    if (shortWidth <= wrapperWidth) {
      const width = Math.max(shortWidth, INLINE_GROUP_MIN_WIDTH);
      if (lineRight !== null && lineRight + INLINE_GROUP_GAP + width > wrapperWidth) closeLine();
      const left = lineRight === null ? 0 : lineRight + INLINE_GROUP_GAP;
      const items: LaidOutTile<T>[] = [];
      let translateX = left;
      g.items.forEach(img => {
        const imageWidth = targetRowHeight * img.aspectRatio;
        items.push({
          ...img,
          style: { width: imageWidth, height: targetRowHeight, translateX, translateY: top + groupTitleHeight },
        });
        translateX += Math.round(imageWidth + gridGap);
      });
      groups.push({
        ...g,
        groupTranslateY: top,
        groupTranslateX: left,
        width: Math.min(width, wrapperWidth - left),
        items,
        height: groupTitleHeight + Math.round(targetRowHeight + gridGap),
      });
      lineRight = left + width;
      return;
    }

    closeLine();
    const items: LaidOutTile<T>[] = [];
    const rowsHeight = layOutRows(g.items, top + groupTitleHeight, wrapperWidth, minAspectRatio, gridGap, items);
    groups.push({ ...g, groupTranslateY: top, items, height: rowsHeight + groupTitleHeight });
    top += groupTitleHeight + rowsHeight + groupGap;
  });
  closeLine();

  // No space below the last image
  return { imageData: groups, newTotalHeight: top - groupGap - gridGap };
}
