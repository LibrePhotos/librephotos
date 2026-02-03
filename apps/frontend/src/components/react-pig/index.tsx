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

// Define TypeScript types
type ImageItem = {
  id: string | number;
  url?: string;
  aspectRatio?: number;
  style?: {
    width?: number;
    translateX?: number;
    translateY?: number;
    height?: number;
    [key: string]: any;
  };
  isTemp?: boolean;
  dominantColor?: string;
  type?: string;
  [key: string]: any;
};

type GroupedImageItem = {
  date: string;
  items: ImageItem[];
  numberOfItems: number;
  updated?: boolean;
  groupTranslateY?: number;
  height?: number;
  location?: string;
  [key: string]: any;
};

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

type PigProps = {
  imageData: ImageItem[] | GroupedImageItem[];
  useLqip?: boolean;
  gridGap?: number;
  getUrl?: ((item: ImageItem, size: number) => string) | null;
  primaryImageBufferHeight?: number;
  secondaryImageBufferHeight?: number;
  sortByDate?: boolean;
  groupByDate?: boolean;
  groupGapSm?: number;
  groupGapLg?: number;
  breakpoint?: number;
  sortFunc?: ((a: any, b: any) => number) | null;
  expandedSize?: number;
  thumbnailSize?: number;
  bgColor?: string;
  handleClick?: ((event: React.MouseEvent, item: ImageItem) => void) | null;
  selectable?: boolean;
  handleSelection?: ((item: ImageItem) => void) | null;
  numberOfItems?: number | null;
  scaleOfImages?: number;
  updateGroups?: ((groups: GroupedImageItem[]) => void) | null;
  updateItems?: ((items: ImageItem[]) => void) | null;
  selectedItems?: ImageItem[] | null;
  toprightoverlay?: React.FC<any> | null;
  bottomleftoverlay?: React.FC<any> | null;
  bottomrightoverlay?: React.FC<any> | null;
  className?: string;
  textAlignment?: "left" | "right";
  headerSize?: "large" | "normal" | "small";
};

// Define types for layout computation functions
type ComputeLayoutParams = {
  imageData: ImageItem[];
  settings: PigSettings;
  wrapperWidth: number;
  scaleOfImages: number;
};

type ComputeLayoutGroupsParams = {
  imageData: GroupedImageItem[];
  settings: PigSettings;
  wrapperWidth: number;
  scaleOfImages: number;
};

type LayoutResult = {
  imageData: ImageItem[] | GroupedImageItem[];
  newTotalHeight: number;
};

// Define the exported ref handle type
export type PigHandle = {
  imageData: any[];
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

function Pig(
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
  }: PigProps,
  ref
) {
  if (!imageData) throw new Error("imageData is missing");

  // State
  const [renderedItems, setRenderedItems] = useState<(ImageItem | GroupedImageItem)[]>([]);
  const [selectedItems, setSelectedItems] = useState<ImageItem[]>([]);
  const [scrollSpeed, setScrollSpeed] = useState<string>("slow");
  const [activeTileUrl, setActiveTileUrl] = useState<string | null>(null);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const containerWidthRef = useRef<number>(0);

  // Define memoized callbacks first before using them in refs
  const defaultHandleSelection = useCallback((item: ImageItem): void => {
    setSelectedItems(prev => {
      if (prev.includes(item)) {
        return prev.filter(value => value !== item);
      }
      return [...prev, item];
    });
  }, []);

  const defaultHandleClick = useCallback((event: React.MouseEvent, item: ImageItem): void => {
    // if an image is already the width of the container, don't expand it on click
    if (item.style?.width && item.style.width >= containerWidthRef.current) {
      setActiveTileUrl(null);
      return;
    }

    setActiveTileUrl(prevUrl => (item.url !== prevUrl ? item.url || null : null));
  }, []);

  // Instance variables (use refs for mutable values that don't trigger re-renders)
  const getUrlFunc = useRef<(item: ImageItem, size: number) => string>(propGetUrl || getUrl);
  const handleClickFunc = useRef<(event: React.MouseEvent, item: ImageItem) => void>(
    propHandleClick || defaultHandleClick
  );
  const handleSelectionFunc = useRef<(item: ImageItem) => void>(propHandleSelection || defaultHandleSelection);
  const selectableRef = useRef<boolean>(selectable);
  const imageDataRef = useRef<(ImageItem | GroupedImageItem)[]>(imageData);
  const numberOfItemsRef = useRef<number>(numberOfItems || imageData.length);
  const scaleOfImagesRef = useRef<number>(scaleOfImages);
  const updateGroupsFunc = useRef<(groups: GroupedImageItem[]) => void>(propUpdateGroups || (() => {}));
  const updateItemsFunc = useRef<(items: ImageItem[]) => void>(propUpdateItems || (() => {}));

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
    else if (propSortByDate) imageDataRef.current = sortByDate(imageDataRef.current as any);

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

  const getUpdatedImageLayout = useCallback((): (ImageItem | GroupedImageItem)[] => {
    if (!containerRef.current) return imageDataRef.current;
    const wrapperWidth = containerRef.current.offsetWidth;

    if (settings.groupByDate) {
      const result = computeLayoutGroups({
        wrapperWidth,
        imageData: imageDataRef.current as GroupedImageItem[],
        settings,
        scaleOfImages: scaleOfImagesRef.current,
      } as ComputeLayoutGroupsParams) as LayoutResult;

      totalHeightRef.current = result.newTotalHeight;
      return result.imageData;
    }

    const result = computeLayout({
      wrapperWidth,
      imageData: imageDataRef.current as ImageItem[],
      settings,
      scaleOfImages: scaleOfImagesRef.current,
    } as ComputeLayoutParams) as LayoutResult;

    totalHeightRef.current = result.newTotalHeight;
    return result.imageData;
  }, [settings]);

  const setRenderedItemsFunc = useCallback(
    (data: (ImageItem | GroupedImageItem)[]) => {
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
    (item: ImageItem) => {
      // Cast the Tile component as any to avoid TypeScript errors
      // since we can't modify the actual Tile component
      const TileComponent = Tile as any;

      return (
        <TileComponent
          key={`tile-${item.id?.toString() || item.url || Math.random().toString(36)}`}
          useLqip={useLqip}
          windowHeight={windowHeightRef.current}
          containerWidth={containerWidthRef.current}
          containerOffsetTop={containerOffsetTopRef.current}
          item={item}
          gridGap={settings.gridGap}
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
          thumbnailSize={thumbnailSize}
          scrollSpeed={scrollSpeed}
          toprightoverlay={toprightoverlay}
          bottomleftoverlay={bottomleftoverlay}
          bottomrightoverlay={bottomrightoverlay}
        />
      );
    },
    [
      useLqip,
      thumbnailSize,
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
    (group: GroupedImageItem) => {
      // Cast the GroupHeader component as any to avoid TypeScript errors
      const GroupHeaderComponent = GroupHeader as any;

      return (
        <React.Fragment key={group.date}>
          <GroupHeaderComponent
            key={group.date}
            settings={settings}
            group={group}
            activeTileUrl={activeTileUrl}
            textAlignment={textAlignment}
            headerSize={headerSize}
          />
          {group.items.map((item: ImageItem, index: number) => (
            <React.Fragment key={item.id?.toString() || item.url || `group-item-${index}`}>
              {renderTile(item)}
            </React.Fragment>
          ))}
        </React.Fragment>
      );
    },
    [settings, activeTileUrl, renderTile]
  );

  const renderFlat = useCallback((item: ImageItem) => renderTile(item), [renderTile]);

  // Render
  return (
    <div className={`${styles.output} ${className}`} ref={containerRef}>
      {renderedItems.map((item, index) => {
        const key = "date" in item && item.date ? item.date : item.id?.toString() || item.url || `item-${index}`;
        return (
          <React.Fragment key={key}>
            {settings.groupByDate ? renderGroup(item as GroupedImageItem) : renderFlat(item as ImageItem)}
          </React.Fragment>
        );
      })}
    </div>
  );
}

const memoizedPig = React.memo(forwardRef(Pig));

export default memoizedPig;
