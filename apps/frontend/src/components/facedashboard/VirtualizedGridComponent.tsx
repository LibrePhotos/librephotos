import cx from "clsx";
import React, { useCallback, useMemo, useState } from "react";
import type { CompletePersonFace } from "../../api_client/faces/types";
import { ScrollScrubber } from "../scrollscrubber/ScrollScrubber";
import { SCROLL_SCRUBBER_TARGET } from "../scrollscrubber/scrollScrubberTarget";
import { ScrollerType } from "../scrollscrubber/scrollScrubberTypes";
import type { ScrollerData } from "../scrollscrubber/scrollScrubberTypes";
import { AutoSizer } from "../virtual/AutoSizer";
import { VirtualGrid } from "../virtual/VirtualGrid";
import type { GridCellProps, SectionRenderedParams, VirtualGridHandle } from "../virtual/VirtualGrid";
import { groupsByRow } from "./faceActionRules";
import type { FaceActionHandlers } from "./faceActionRules";
import { FaceComponent } from "./FaceComponent";
import { FaceGridRow } from "./FaceGridRow";
import type { HeaderVariant } from "./FaceGridRow";
import { faceRowHeights, faceRowKinds, layoutWidthOf } from "./faceGridRows";
import type { FaceGridLayout } from "./faceGridRows";
import type { FacesTab } from "./facesTab";
import { HeaderComponent } from "./HeaderComponent";
import { usePeopleCovers } from "./hooks/usePeopleCovers";
import type { FaceCell, FaceSelection, GridCell, GridRows } from "./hooks/useVirtualizedGrid";
import { isLoadedFace } from "./hooks/useVirtualizedGrid";
import { coverFaceUrl } from "./personCover";
import classes from "./VirtualizedGridComponent.module.css";

type VirtualizedGridComponentProps = {
  containerRef: React.Ref<HTMLDivElement>;
  gridRef: React.RefObject<VirtualGridHandle | null>;
  gridHeight: number;
  getCellContentsForTab: (tab: FacesTab) => GridRows;
  getScrollPositions: () => ScrollerData[];
  handleScrubberScroll: (y: number) => void;
  onSectionRendered: (params: SectionRenderedParams) => void;
  scrollPosition: number | undefined;
  onScroll: (params: { scrollTop: number }) => void;
  handleCellClick: (e: React.MouseEvent, cell: FaceCell) => void;
  handleShowClick: (e: React.MouseEvent, cell: FaceCell) => void;
  selectMode: boolean;
  selectedFaces: FaceSelection[];
  setSelectedFaces: (faces: FaceSelection[]) => void;
  activeTab: FacesTab;
  /** The columns and face size the rows were built for (useVirtualizedGrid). */
  layout: FaceGridLayout;
  onToggleCollapse: (personId: number) => void;
  faceActions: FaceActionHandlers;
  pendingFaceIds: ReadonlySet<number>;
  /** The A-Z scrubber only fits the name order (#764). */
  showScrubber: boolean;
  /** "Add a name" on a cluster: label all of its faces (the dashboard's Label faces dialog). */
  onNameGroup?: (faces: FaceSelection[]) => void;
};

const NO_SCROLL_POSITIONS: ScrollerData[] = [];
const HEADER_STYLE: React.CSSProperties = {};

export function VirtualizedGridComponent({
  containerRef,
  gridRef,
  gridHeight,
  getCellContentsForTab,
  getScrollPositions,
  handleScrubberScroll,
  onSectionRendered,
  scrollPosition,
  onScroll,
  handleCellClick,
  handleShowClick,
  selectMode,
  selectedFaces,
  setSelectedFaces,
  activeTab,
  layout,
  onToggleCollapse,
  faceActions,
  pendingFaceIds,
  showScrubber,
  onNameGroup,
}: VirtualizedGridComponentProps) {
  const rows = getCellContentsForTab(activeTab);
  // Rows of tiles and the slices of open groups (faceGridRows.ts)
  const kinds = useMemo(() => faceRowKinds(rows), [rows]);
  const heights = useMemo(() => faceRowHeights(rows, layout), [rows, layout]);
  const rowHeight = useCallback(({ index }: { index: number }) => heights[index] ?? 0, [heights]);
  // The People page's cover of each person, for an open group's header (#860)
  const ownCovers = usePeopleCovers();
  // Folding swaps a group's section for a tile (and back): the group whose new toggle takes focus
  const [focusPerson, setFocusPerson] = useState<number | null>(null);
  const toggleCollapse = useCallback(
    (personId: number) => {
      setFocusPerson(personId);
      onToggleCollapse(personId);
    },
    [onToggleCollapse]
  );
  const focusTaken = useCallback(() => setFocusPerson(null), []);
  // A face's actions depend on its group (person, cluster or unknown), which is the header above it
  const rowGroups = useMemo(() => groupsByRow(rows), [rows]);

  const renderHeader = useCallback(
    (cell: CompletePersonFace, variant: HeaderVariant) => (
      <HeaderComponent
        style={HEADER_STYLE}
        variant={variant}
        cell={cell}
        selectedFaces={selectedFaces}
        setSelectedFaces={setSelectedFaces}
        onToggleCollapse={() => toggleCollapse(cell.id)}
        coverUrl={coverFaceUrl(cell, ownCovers.get(cell.id))}
        takeFocus={focusPerson === cell.id}
        onFocused={focusTaken}
        onNameGroup={onNameGroup}
      />
    ),
    [selectedFaces, setSelectedFaces, toggleCollapse, ownCovers, focusPerson, focusTaken, onNameGroup]
  );

  const renderFace = useCallback(
    (cell: GridCell, group: CompletePersonFace | undefined) =>
      // A placeholder until its page has loaded
      isLoadedFace(cell) ? (
        <FaceComponent
          handleClick={handleCellClick}
          handleShowClick={handleShowClick}
          cell={cell}
          group={group}
          tab={activeTab}
          actions={faceActions}
          pending={pendingFaceIds.has(cell.id)}
          isScrollingFast={false}
          selectMode={selectMode}
          isSelected={selectedFaces.some(face => face.face_id === cell.id)}
          faceSize={layout.faceSize}
        />
      ) : null,
    [
      activeTab,
      layout.faceSize,
      selectedFaces,
      handleCellClick,
      handleShowClick,
      selectMode,
      faceActions,
      pendingFaceIds,
    ]
  );

  // Each row is rendered whole: a row of tiles or a slice of an open group
  const cellRenderer = useCallback(
    ({ key, rowIndex, style }: GridCellProps) => {
      const cells = rows[rowIndex];
      const kind = kinds[rowIndex];
      if (!cells || !kind) return null;
      return (
        <FaceGridRow
          key={key}
          style={style}
          kind={kind}
          cells={cells}
          layout={layout}
          group={rowGroups[rowIndex]}
          renderHeader={renderHeader}
          renderFace={renderFace}
        />
      );
    },
    [rows, kinds, layout, rowGroups, renderHeader, renderFace]
  );

  return (
    <div className={classes.container} ref={containerRef}>
      <AutoSizer>
        {({ height, width: gridWidth }) => (
          <ScrollScrubber
            scrollPositions={showScrubber ? getScrollPositions() : NO_SCROLL_POSITIONS}
            scrollToY={handleScrubberScroll}
            targetHeight={gridHeight}
            type={ScrollerType.enum.alphabet}
          >
            <VirtualGrid
              ref={gridRef}
              className={cx(classes.grid, SCROLL_SCRUBBER_TARGET)}
              cellRenderer={cellRenderer}
              // One column: the rows lay out their own tiles, and stop short of a scrollbar
              columnWidth={layoutWidthOf(gridWidth)}
              columnCount={1}
              rowHeight={rowHeight}
              onSectionRendered={onSectionRendered}
              height={height}
              width={gridWidth}
              rowCount={rows.length}
              scrollTop={scrollPosition} // Only defined for programmatic scrolls
              onScroll={onScroll}
              // The face menus and buttons are focusable: scrolling away from one keeps it
              keepFocusedRowMounted
            />
          </ScrollScrubber>
        )}
      </AutoSizer>
    </div>
  );
}
