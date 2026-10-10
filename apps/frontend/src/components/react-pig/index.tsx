import { useDebouncedCallback, useThrottledCallback } from "@mantine/hooks";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import calcRenderableItems from "./calcRenderableItems";
import type { ScrollDirection } from "./calcRenderableItems";
import GroupHeader from "./components/GroupHeader/GroupHeader";
import Tile from "./components/Tile/Tile";
import computeLayout from "./computeLayout";
import computeLayoutGroups from "./computeLayoutGroups";
import styles from "./styles.module.css";
import { isGroupEntry, isTileEntry } from "./types";
import type {
  GroupedImageItem,
  HeaderSize,
  ImageItem,
  LaidOutGroup,
  LaidOutTile,
  PigEntry,
  PigLayout,
  PigOverlay,
  PigSettings,
  PigTile,
  ScrollSpeed,
} from "./types";
import getScrollSpeed from "./utils/getScrollSpeed";
import getUrl from "./utils/getUrl";
import sortByDate from "./utils/sortByDate";

export type { GroupedImageItem, ImageItem, PigEntry, PigTile, PigTileStyle } from "./types";

/**
 * A group as `updateGroups` reports it to a paginated date list: only its
 * tiles on screen, plus the group's cursor id, which names the page to load.
 */
export type PigVisibleGroup<T extends ImageItem = ImageItem> = GroupedImageItem<T> & { id: string };

export type PigProps<T extends ImageItem> = {
  imageData: T[] | GroupedImageItem<T>[];
  useLqip?: boolean;
  gridGap?: number;
  /** Builds an image or video URL from a tile's `url`; Tile calls it for loaded tiles only. */
  getUrl?: ((url: string, size: number) => string) | null;
  primaryImageBufferHeight?: number;
  secondaryImageBufferHeight?: number;
  sortByDate?: boolean;
  groupByDate?: boolean;
  groupGapSm?: number;
  groupGapLg?: number;
  breakpoint?: number;
  sortFunc?: ((a: PigEntry<T>, b: PigEntry<T>) => number) | null;
  expandedSize?: number;
  thumbnailSize?: number;
  bgColor?: string;
  handleClick?: ((event: React.MouseEvent, item: T) => void) | null;
  selectable?: boolean;
  handleSelection?: ((item: T) => void) | null;
  numberOfItems?: number | null;
  scaleOfImages?: number;
  updateGroups?: ((groups: GroupedImageItem<T>[]) => void) | null;
  updateItems?: ((items: T[]) => void) | null;
  selectedItems?: T[] | null;
  toprightoverlay?: PigOverlay<T> | null;
  bottomleftoverlay?: PigOverlay<T> | null;
  bottomrightoverlay?: PigOverlay<T> | null;
  className?: string;
  textAlignment?: "left" | "right";
  headerSize?: HeaderSize;
};

/** The ref handle: the computed layout (tiles or groups of tiles) and its height. */
export type PigHandle<T extends ImageItem = ImageItem> = {
  imageData: PigEntry<PigTile<T>>[];
  totalHeight: number;
};

// export function addTempElementsToGroups(photosGroupedByDate: GroupedImageItem[]): void {
//   photosGroupedByDate.forEach(group => {
//     for (let i = 0; i < group.numberOfItems; i += 1) {
//       group.items.push({ id: i, aspectRatio: 1, isTemp: true });
//     }
//   });
// }
//
// export function addTempElementsToFlatList(photosCount: number): ImageItem[] {
//   const tempPhotos: ImageItem[] = [];
//   for (let i = 0; i < photosCount; i += 1) {
//     tempPhotos.push({ id: i, aspectRatio: 1, isTemp: true });
//   }
//   return tempPhotos;
// }

// The entries of a layout, as Pig keeps them in imageDataRef and hands them out
// through its ref: the layout's own array, so sorting one sorts the other.
function entriesOf<T extends ImageItem>(layout: PigLayout<T>): PigEntry<T>[] {
  return layout.grouped ? layout.groups : layout.tiles;
}

function Pig<T extends ImageItem>(
  {
    imageData,
    useLqip = true,
    gridGap = 8,
    getUrl: propGetUrl = null,
    primaryImageBufferHeight = 2500,
    secondaryImageBufferHeight = 100,
    sortByDate: propSortByDate = false,
    groupByDate = false,
    groupGapSm = 50,
    groupGapLg = 50,
    breakpoint = 800,
    sortFunc = null,
    expandedSize = 1000,
    thumbnailSize = 20,
    bgColor = "#fff",
    handleClick: propHandleClick = null,
    selectable = false,
    handleSelection: propHandleSelection = null,
    numberOfItems = null,
    scaleOfImages = 1,
    updateGroups: propUpdateGroups = null,
    updateItems: propUpdateItems = null,
    selectedItems: propSelectedItems = null,
    toprightoverlay = null,
    bottomleftoverlay = null,
    bottomrightoverlay = null,
    className = "",
    textAlignment = "right",
    headerSize = "large",
  }: PigProps<T>,
  ref: React.ForwardedRef<PigHandle<T>>
) {
  if (!imageData) throw new Error("imageData is missing");

  // State
  const [renderedItems, setRenderedItems] = useState<PigLayout<T>>({ grouped: false, tiles: [] });
  const [selectedItems, setSelectedItems] = useState<T[]>([]);
  const [scrollSpeed, setScrollSpeed] = useState<ScrollSpeed>("slow");
  const [activeTileUrl, setActiveTileUrl] = useState<string | null>(null);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidthRef = useRef<number>(0);

  // Define memoized callbacks first before using them in refs
  const defaultHandleSelection = useCallback((item: T): void => {
    setSelectedItems(prev => {
      if (prev.includes(item)) {
        return prev.filter(value => value !== item);
      }
      return [...prev, item];
    });
  }, []);

  const defaultHandleClick = useCallback((event: React.MouseEvent, item: T): void => {
    // if an image is already the width of the container, don't expand it on click
    if (item.style?.width && item.style.width >= containerWidthRef.current) {
      setActiveTileUrl(null);
      return;
    }

    setActiveTileUrl(prevUrl => (item.url !== prevUrl ? item.url || null : null));
  }, []);

  // Instance variables (use refs for mutable values that don't trigger re-renders)
  const getUrlFunc = useRef<(url: string, size: number) => string>(propGetUrl || getUrl);
  const handleClickFunc = useRef<(event: React.MouseEvent, item: T) => void>(propHandleClick || defaultHandleClick);
  const handleSelectionFunc = useRef<(item: T) => void>(propHandleSelection || defaultHandleSelection);
  const selectableRef = useRef<boolean>(selectable);
  // The caller's data until the first layout, then the laid-out entries.
  const imageDataRef = useRef<PigEntry<T>[]>(imageData);
  // The layout the grid renders from; null until Pig has measured its container.
  const layoutRef = useRef<PigLayout<T> | null>(null);
  const numberOfItemsRef = useRef<number>(numberOfItems || imageData.length);
  const scaleOfImagesRef = useRef<number>(scaleOfImages);
  const updateGroupsFunc = useRef<(groups: GroupedImageItem<T>[]) => void>(propUpdateGroups || (() => {}));
  const updateItemsFunc = useRef<(items: T[]) => void>(propUpdateItems || (() => {}));

  // Other instance variables
  const scrollThrottleMs = 300;
  const windowHeightRef = useRef<number>(typeof window !== "undefined" ? window.innerHeight : 1000);
  const containerOffsetTopRef = useRef<number | null>(null);
  const totalHeightRef = useRef<number>(0);
  // const minAspectRatioRef = useRef<number | null>(null);
  const latestYOffsetRef = useRef<number>(0);
  const previousYOffsetRef = useRef<number>(0);
  const scrollDirectionRef = useRef<ScrollDirection>("down");

  // Expose ref methods
  useImperativeHandle(ref, () => ({
    imageData: imageDataRef.current,
    totalHeight: totalHeightRef.current,
  }));

  // Sort image data if needed
  useEffect(() => {
    if (sortFunc) imageDataRef.current.sort(sortFunc);
    else if (propSortByDate) imageDataRef.current = sortByDate(imageDataRef.current);

    // Check grouping ability
    if (groupByDate && imageDataRef.current.length > 0 && !("items" in imageDataRef.current[0])) {
      // eslint-disable-next-line no-console
      console.error(`Data provided is not grouped yet. Please check the docs, you'll need to use groupify.js`);
    }
    if (!groupByDate && imageDataRef.current.length > 0 && "items" in imageDataRef.current[0]) {
      // eslint-disable-next-line no-console
      console.error(`Data provided is grouped, please include the groupByDate prop`);
    }
  }, [sortFunc, propSortByDate, groupByDate]);

  // Settings
  const settings = useMemo<PigSettings>(
    () => ({
      gridGap,
      bgColor,
      primaryImageBufferHeight,
      secondaryImageBufferHeight,
      expandedSize,
      thumbnailSize,
      groupByDate,
      breakpoint,
      groupGapSm,
      groupGapLg,
      headerSize,
    }),
    [
      gridGap,
      bgColor,
      primaryImageBufferHeight,
      secondaryImageBufferHeight,
      expandedSize,
      thumbnailSize,
      groupByDate,
      breakpoint,
      groupGapSm,
      groupGapLg,
      headerSize,
    ]
  );

  // Lays out imageDataRef: date groups with `groupByDate`, tiles without (an
  // entry of the other kind gets no place). Null while there is no container.
  const getUpdatedImageLayout = useCallback((): PigLayout<T> | null => {
    if (!containerRef.current) return null;
    const wrapperWidth = containerRef.current.offsetWidth;

    if (settings.groupByDate) {
      const result = computeLayoutGroups({
        wrapperWidth,
        imageData: imageDataRef.current.filter(isGroupEntry),
        settings,
        scaleOfImages: scaleOfImagesRef.current,
      });

      totalHeightRef.current = result.newTotalHeight;
      return { grouped: true, groups: result.imageData };
    }

    const result = computeLayout({
      wrapperWidth,
      imageData: imageDataRef.current.filter(isTileEntry),
      settings,
      scaleOfImages: scaleOfImagesRef.current,
    });

    totalHeightRef.current = result.newTotalHeight;
    return { grouped: false, tiles: result.imageData };
  }, [settings]);

  // Keeps a fresh layout, and the entries it placed, for the scroll handler and the ref handle.
  const storeLayout = useCallback((layout: PigLayout<T> | null) => {
    layoutRef.current = layout;
    if (layout) imageDataRef.current = entriesOf(layout);
  }, []);

  const setRenderedItemsFunc = useCallback(
    (layout: PigLayout<T>) => {
      // Set the container height, only need to do this once.
      if (containerRef.current && !containerRef.current.style.height) {
        containerRef.current.style.height = `${totalHeightRef.current}px`;
      }

      const items = calcRenderableItems({
        containerOffsetTop: containerOffsetTopRef.current,
        scrollDirection: scrollDirectionRef.current,
        settings,
        latestYOffset: latestYOffsetRef.current,
        layout,
        windowHeight: windowHeightRef.current,
        updateGroups: updateGroupsFunc.current,
        updateItems: updateItemsFunc.current,
      });

      setRenderedItems(items);
    },
    [settings]
  );

  const onScroll = useCallback(() => {
    previousYOffsetRef.current = latestYOffsetRef.current || window.pageYOffset;
    latestYOffsetRef.current = window.pageYOffset;
    scrollDirectionRef.current = latestYOffsetRef.current > previousYOffsetRef.current ? "down" : "up";

    window.requestAnimationFrame(() => {
      // Content above the grid can load after it (the timeline's memories), so
      // the offset measured at mount goes stale and the top rows were culled.
      if (containerRef.current) containerOffsetTopRef.current = containerRef.current.offsetTop;
      if (layoutRef.current) setRenderedItemsFunc(layoutRef.current);

      // measure users scrolling speed and set it to state, used for conditional tile rendering
      const speed = getScrollSpeed(latestYOffsetRef.current, scrollThrottleMs, s => {
        setScrollSpeed(s); // scroll idle callback
      });
      setScrollSpeed(speed);

      // dismiss any active Tile
      if (activeTileUrl) setActiveTileUrl(null);
    });
  }, [activeTileUrl, setRenderedItemsFunc]);

  const onResize = useCallback(() => {
    const layout = getUpdatedImageLayout();
    storeLayout(layout);
    if (layout) setRenderedItemsFunc(layout);
    if (containerRef.current) {
      containerRef.current.style.height = `${totalHeightRef.current}px`; // set the container height again based on new layout
      containerWidthRef.current = containerRef.current.offsetWidth;
      containerOffsetTopRef.current = containerRef.current.offsetTop;
    }
    windowHeightRef.current = window.innerHeight;
  }, [getUpdatedImageLayout, storeLayout, setRenderedItemsFunc]);

  // Create throttled and debounced functions using Mantine hooks
  const throttledScroll = useThrottledCallback(onScroll, scrollThrottleMs);

  const debouncedResize = useDebouncedCallback(onResize, 500);

  // Equivalent to componentDidMount and componentWillUnmount
  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    containerOffsetTopRef.current = containerRef.current.offsetTop;
    containerWidthRef.current = containerRef.current.offsetWidth;

    const layout = getUpdatedImageLayout();
    storeLayout(layout);
    if (layout) setRenderedItemsFunc(layout);

    window.addEventListener("scroll", throttledScroll);
    window.addEventListener("resize", debouncedResize);

    // eslint-disable-next-line consistent-return
    return () => {
      window.removeEventListener("scroll", throttledScroll);
      window.removeEventListener("resize", debouncedResize);
    };
  }, [throttledScroll, debouncedResize, getUpdatedImageLayout, storeLayout, setRenderedItemsFunc]);

  // Equivalent to componentDidUpdate
  useEffect(() => {
    imageDataRef.current = imageData;
    // Before the layout reads it: set after, a new photo size took effect one change late.
    scaleOfImagesRef.current = scaleOfImages;
    const layout = getUpdatedImageLayout();
    storeLayout(layout);
    if (containerRef.current) {
      containerRef.current.style.height = `${totalHeightRef.current}px`; // set the container height again based on new layout
      containerWidthRef.current = containerRef.current.offsetWidth;
      containerOffsetTopRef.current = containerRef.current.offsetTop;
    }
    windowHeightRef.current = window.innerHeight;
    if (layout) setRenderedItemsFunc(layout);
  }, [imageData, scaleOfImages, getUpdatedImageLayout, storeLayout, setRenderedItemsFunc]);

  // Update refs when props change
  useEffect(() => {
    getUrlFunc.current = propGetUrl || getUrl;
    handleClickFunc.current = propHandleClick || defaultHandleClick;
    handleSelectionFunc.current = propHandleSelection || defaultHandleSelection;
    selectableRef.current = selectable;
    numberOfItemsRef.current = numberOfItems || imageData.length;
    updateGroupsFunc.current = propUpdateGroups || function onUpdateGroups() {};
    updateItemsFunc.current = propUpdateItems || function onUpdateItems() {};
  }, [
    propGetUrl,
    propHandleClick,
    propHandleSelection,
    selectable,
    numberOfItems,
    imageData,
    propUpdateGroups,
    propUpdateItems,
    defaultHandleClick,
    defaultHandleSelection,
  ]);

  // Render methods
  const renderTile = useCallback(
    (item: LaidOutTile<T>) => {
      return (
        <Tile
          key={`tile-${item.id?.toString() || item.url || Math.random().toString(36)}`}
          useLqip={useLqip}
          windowHeight={windowHeightRef.current}
          containerWidth={containerWidthRef.current}
          containerOffsetTop={containerOffsetTopRef.current}
          item={item}
          getUrl={getUrlFunc.current}
          handleClick={handleClickFunc.current}
          handleSelection={handleSelectionFunc.current}
          selectable={selectableRef.current}
          selected={
            propSelectedItems
              ? propSelectedItems.findIndex(selectedItem => selectedItem.id === item.id) >= 0
              : selectedItems.includes(item)
          }
          activeTileUrl={activeTileUrl}
          settings={settings}
          scrollSpeed={scrollSpeed}
          toprightoverlay={toprightoverlay}
          bottomleftoverlay={bottomleftoverlay}
          bottomrightoverlay={bottomrightoverlay}
        />
      );
    },
    [
      useLqip,
      toprightoverlay,
      bottomleftoverlay,
      bottomrightoverlay,
      settings,
      selectedItems,
      activeTileUrl,
      scrollSpeed,
      propSelectedItems,
    ]
  );

  const renderGroup = useCallback(
    (group: LaidOutGroup<T>) => {
      return (
        <React.Fragment key={group.date}>
          <GroupHeader
            settings={settings}
            group={group}
            activeTileUrl={activeTileUrl}
            textAlignment={textAlignment}
            headerSize={headerSize}
          />
          {group.items.map((item, index) => (
            <React.Fragment key={item.id?.toString() || item.url || `group-item-${index}`}>
              {renderTile(item)}
            </React.Fragment>
          ))}
        </React.Fragment>
      );
    },
    [settings, activeTileUrl, renderTile, textAlignment, headerSize]
  );

  const renderFlat = useCallback((item: LaidOutTile<T>) => renderTile(item), [renderTile]);

  // Render
  // Key by id where there is one (photos, date-album groups): the suffix below
  // counts within the rendered window only, so it shifts as groups scroll out
  // and would remount their tiles. Search and user-album groups have no id and
  // fall back to their date label, which two groups can share (two UTC days
  // that fall on the same local day); suffix repeats so keys stay unique.
  const seenKeys = new Map<string, number>();
  const uniqueKey = (baseKey: string) => {
    const repeat = seenKeys.get(baseKey) ?? 0;
    seenKeys.set(baseKey, repeat + 1);
    return repeat ? `${baseKey}#${repeat}` : baseKey;
  };
  return (
    <div className={`${styles.output} ${className}`} ref={containerRef}>
      {renderedItems.grouped
        ? renderedItems.groups.map((group, index) => (
            <React.Fragment key={uniqueKey(group.id?.toString() || group.date || `item-${index}`)}>
              {renderGroup(group)}
            </React.Fragment>
          ))
        : renderedItems.tiles.map((tile, index) => (
            <React.Fragment key={uniqueKey(tile.id?.toString() || tile.date || tile.url || `item-${index}`)}>
              {renderFlat(tile)}
            </React.Fragment>
          ))}
    </div>
  );
}

// forwardRef and memo drop Pig's type parameter (they take a fixed props
// type); restore it so a caller's callbacks get its own item type back.
type PigComponent = <T extends ImageItem>(
  props: PigProps<T> & React.RefAttributes<PigHandle<T>>
) => React.ReactElement | null;

// True at runtime: memo and forwardRef hand the props and the ref to Pig unchanged.
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- generic memo, see above
const memoizedPig = React.memo(forwardRef(Pig)) as PigComponent;

export default memoizedPig;
