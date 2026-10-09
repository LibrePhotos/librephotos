import { useDebouncedCallback, useThrottledCallback } from "@mantine/hooks";
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import calcRenderableItems from "./calcRenderableItems";
import GroupHeader from "./components/GroupHeader/GroupHeader";
import Tile from "./components/Tile/Tile";
import computeLayout from "./computeLayout";
import computeLayoutGroups from "./computeLayoutGroups";
import styles from "./styles.module.css";
import getScrollSpeed from "./utils/getScrollSpeed";
import getUrl from "./utils/getUrl";
import sortByDate from "./utils/sortByDate";

/** A tile's position and size, as computeLayout / computeLayoutGroups set it. */
export type PigTileStyle = {
  width?: number;
  height?: number;
  translateX?: number;
  translateY?: number;
};

/**
 * One tile. Callers pass their own item type (photos carry many more fields);
 * Pig hands copies of those items, with `style` filled in, to its callbacks.
 */
export type ImageItem = {
  id: string | number;
  url?: string;
  aspectRatio?: number;
  style?: PigTileStyle;
  isTemp?: boolean;
  dominantColor?: string;
  type?: string;
  /** When it was taken; Tile puts it in its label. */
  date?: string | null;
};

/** A date group of tiles, for `groupByDate`. */
export type GroupedImageItem<T extends ImageItem = ImageItem> = {
  /** The date-album cursor; only the paginated date lists have one. */
  id?: string;
  date: string | null;
  items: T[];
  numberOfItems?: number;
  updated?: boolean;
  groupTranslateY?: number;
  height?: number;
  location?: string | null;
  /** Pig ignores these; the scroll scrubber reads them back from the handle. */
  year?: number | null;
  month?: number | null;
};

/**
 * A group as `updateGroups` reports it to a paginated date list: only its
 * tiles on screen, plus the group's cursor id, which names the page to load.
 */
export type PigVisibleGroup<T extends ImageItem = ImageItem> = GroupedImageItem<T> & { id: string };

/** An entry of Pig's data: a tile, or (with `groupByDate`) a date group. */
export type PigEntry<T extends ImageItem = ImageItem> = T | GroupedImageItem<T>;

/** A tile as Pig lays it out: the caller's item plus its `style` (unset until the first layout). */
export type PigTile<T extends ImageItem = ImageItem> = T & { style?: PigTileStyle };

/** A group after computeLayoutGroups: positioned, and its tiles have their `style`. */
type LaidOutGroup<T extends ImageItem> = GroupedImageItem<T> & { groupTranslateY: number; height: number };

/** A tile overlay (favourite star, stack badge, video length); Tile renders it with the tile's item. */
type PigOverlay<T extends ImageItem> = React.ComponentType<{ item: T }>;

type PigSettings = {
  gridGap: number;
  bgColor: string;
  primaryImageBufferHeight: number;
  secondaryImageBufferHeight: number;
  expandedSize: number;
  thumbnailSize: number;
  groupByDate: boolean;
  breakpoint: number;
  groupGapSm: number;
  groupGapLg: number;
  headerSize?: "large" | "normal" | "small";
};

/** The props Pig renders Tile with; Tile is plain JS, so they are spelled out here. */
type TileProps<T extends ImageItem> = {
  item: T;
  useLqip: boolean;
  windowHeight: number;
  containerWidth: number;
  containerOffsetTop: number | null;
  getUrl: (url: string, size: number) => string;
  handleClick: (event: React.MouseEvent, item: T) => void;
  handleSelection: (item: T) => void;
  selectable: boolean;
  selected: boolean;
  activeTileUrl: string | null;
  settings: PigSettings;
  scrollSpeed: string;
  toprightoverlay: PigOverlay<T> | null;
  bottomleftoverlay: PigOverlay<T> | null;
  bottomrightoverlay: PigOverlay<T> | null;
};

// Tile.jsx infers no props of its own; this gives Pig's use of it a checked shape.
const TypedTile: <T extends ImageItem>(props: TileProps<T>) => React.ReactNode = Tile;

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
  headerSize?: "large" | "normal" | "small";
};

// Define types for layout computation functions
type ComputeLayoutParams<T extends ImageItem> = {
  imageData: T[];
  settings: PigSettings;
  wrapperWidth: number;
  scaleOfImages: number;
};

type ComputeLayoutGroupsParams<T extends ImageItem> = {
  imageData: GroupedImageItem<T>[];
  settings: PigSettings;
  wrapperWidth: number;
  scaleOfImages: number;
};

type LayoutResult<T extends ImageItem> = {
  imageData: PigEntry<T>[];
  newTotalHeight: number;
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
  const [renderedItems, setRenderedItems] = useState<(T | LaidOutGroup<T>)[]>([]);
  const [selectedItems, setSelectedItems] = useState<T[]>([]);
  const [scrollSpeed, setScrollSpeed] = useState<string>("slow");
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
  const imageDataRef = useRef<PigEntry<T>[]>(imageData);
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
  const scrollDirectionRef = useRef<string>("down");

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

  const getUpdatedImageLayout = useCallback((): PigEntry<T>[] => {
    if (!containerRef.current) return imageDataRef.current;
    const wrapperWidth = containerRef.current.offsetWidth;

    if (settings.groupByDate) {
      const params: ComputeLayoutGroupsParams<T> = {
        wrapperWidth,
        imageData: imageDataRef.current as GroupedImageItem<T>[],
        settings,
        scaleOfImages: scaleOfImagesRef.current,
      };
      const result: LayoutResult<T> = computeLayoutGroups(params);

      totalHeightRef.current = result.newTotalHeight;
      return result.imageData;
    }

    const params: ComputeLayoutParams<T> = {
      wrapperWidth,
      imageData: imageDataRef.current as T[],
      settings,
      scaleOfImages: scaleOfImagesRef.current,
    };
    const result: LayoutResult<T> = computeLayout(params);

    totalHeightRef.current = result.newTotalHeight;
    return result.imageData;
  }, [settings]);

  const setRenderedItemsFunc = useCallback(
    (data: PigEntry<T>[]) => {
      // Set the container height, only need to do this once.
      if (containerRef.current && !containerRef.current.style.height) {
        containerRef.current.style.height = `${totalHeightRef.current}px`;
      }

      const items = calcRenderableItems({
        containerOffsetTop: containerOffsetTopRef.current,
        scrollDirection: scrollDirectionRef.current,
        settings,
        latestYOffset: latestYOffsetRef.current,
        imageData: data,
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
      setRenderedItemsFunc(imageDataRef.current);

      // measure users scrolling speed and set it to state, used for conditional tile rendering
      const speed = getScrollSpeed(latestYOffsetRef.current, scrollThrottleMs, (s: string) => {
        setScrollSpeed(s); // scroll idle callback
      });
      setScrollSpeed(speed);

      // dismiss any active Tile
      if (activeTileUrl) setActiveTileUrl(null);
    });
  }, [activeTileUrl, setRenderedItemsFunc]);

  const onResize = useCallback(() => {
    imageDataRef.current = getUpdatedImageLayout();
    setRenderedItemsFunc(imageDataRef.current);
    if (containerRef.current) {
      containerRef.current.style.height = `${totalHeightRef.current}px`; // set the container height again based on new layout
      containerWidthRef.current = containerRef.current.offsetWidth;
      containerOffsetTopRef.current = containerRef.current.offsetTop;
    }
    windowHeightRef.current = window.innerHeight;
  }, [getUpdatedImageLayout, setRenderedItemsFunc]);

  // Create throttled and debounced functions using Mantine hooks
  const throttledScroll = useThrottledCallback(onScroll, scrollThrottleMs);

  const debouncedResize = useDebouncedCallback(onResize, 500);

  // Equivalent to componentDidMount and componentWillUnmount
  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    containerOffsetTopRef.current = containerRef.current.offsetTop;
    containerWidthRef.current = containerRef.current.offsetWidth;

    imageDataRef.current = getUpdatedImageLayout();
    setRenderedItemsFunc(imageDataRef.current);

    window.addEventListener("scroll", throttledScroll);
    window.addEventListener("resize", debouncedResize);

    // eslint-disable-next-line consistent-return
    return () => {
      window.removeEventListener("scroll", throttledScroll);
      window.removeEventListener("resize", debouncedResize);
    };
  }, [throttledScroll, debouncedResize, getUpdatedImageLayout, setRenderedItemsFunc]);

  // Equivalent to componentDidUpdate
  useEffect(() => {
    imageDataRef.current = imageData;
    imageDataRef.current = getUpdatedImageLayout();
    if (containerRef.current) {
      containerRef.current.style.height = `${totalHeightRef.current}px`; // set the container height again based on new layout
      containerWidthRef.current = containerRef.current.offsetWidth;
      containerOffsetTopRef.current = containerRef.current.offsetTop;
    }
    windowHeightRef.current = window.innerHeight;
    scaleOfImagesRef.current = scaleOfImages;
    setRenderedItemsFunc(imageDataRef.current);
  }, [imageData, scaleOfImages, getUpdatedImageLayout, setRenderedItemsFunc]);

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
    (item: T) => {
      return (
        <TypedTile
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

  const renderFlat = useCallback((item: T) => renderTile(item), [renderTile]);

  // Render
  // Key by id where there is one (photos, date-album groups): the suffix below
  // counts within the rendered window only, so it shifts as groups scroll out
  // and would remount their tiles. Search and user-album groups have no id and
  // fall back to their date label, which two groups can share (two UTC days
  // that fall on the same local day); suffix repeats so keys stay unique.
  const seenKeys = new Map<string, number>();
  return (
    <div className={`${styles.output} ${className}`} ref={containerRef}>
      {renderedItems.map((item, index) => {
        const baseKey = item.id?.toString() || item.date || ("items" in item ? undefined : item.url) || `item-${index}`;
        const repeat = seenKeys.get(baseKey) ?? 0;
        seenKeys.set(baseKey, repeat + 1);
        const key = repeat ? `${baseKey}#${repeat}` : baseKey;
        return (
          <React.Fragment key={key}>
            {settings.groupByDate ? renderGroup(item as LaidOutGroup<T>) : renderFlat(item as T)}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// forwardRef and memo drop Pig's type parameter (they take a fixed props
// type); restore it so a caller's callbacks get its own item type back.
type PigComponent = <T extends ImageItem>(
  props: PigProps<T> & React.RefAttributes<PigHandle<T>>
) => React.ReactElement | null;

const memoizedPig = React.memo(forwardRef(Pig)) as PigComponent;

export default memoizedPig;
