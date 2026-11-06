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
import { faceRowKinds, layoutWidthOf, PERSON_CELL, rowHeightOf } from "./faceGridRows";
import type { FacesTab } from "./facesTab";
import { HeaderComponent } from "./HeaderComponent";
import { usePeopleCovers } from "./hooks/usePeopleCovers";
import type { FaceCell, FaceSelection, GridCell, GridRows } from "./hooks/useVirtualizedGrid";
import { isLoadedFace } from "./hooks/useVirtualizedGrid";
import { PersonCell } from "./PersonCell";
import { coverFaceUrl } from "./personCover";
import classes from "./VirtualizedGridComponent.module.css";

type VirtualizedGridComponentProps = {
  containerRef: React.Ref<HTMLDivElement>;
  gridRef: React.RefObject<VirtualGridHandle | null>;
  /** A face's cell: the face and the space around it. */
  entrySquareSize: number;
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
  collapsedPersons: ReadonlySet<number>;
  onToggleCollapse: (personId: number) => void;
  faceActions: FaceActionHandlers;
  pendingFaceIds: ReadonlySet<number>;
  /** The A-Z scrubber only fits the name order (#764). */
  showScrubber: boolean;
  /** "Add a name" on a cluster: label all of its faces (the dashboard's Label faces dialog). */
  onNameGroup?: (faces: FaceSelection[]) => void;
};

const NO_SCROLL_POSITIONS: ScrollerData[] = [];
/** A header fills its card's header line; a folded person a fixed cell. */
const HEADER_STYLE: React.CSSProperties = {};
const PERSON_STYLE: React.CSSProperties = { width: PERSON_CELL, height: PERSON_CELL };

export function VirtualizedGridComponent({
  containerRef,
  gridRef,
  entrySquareSize,
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
  collapsedPersons,
  onToggleCollapse,
  faceActions,
  pendingFaceIds,
  showScrubber,
  onNameGroup,
}: VirtualizedGridComponentProps) {
  const rows = getCellContentsForTab(activeTab);
  // Shelves of cards, slices of a wide card and rows of folded people (faceGridRows.ts)
  const kinds = useMemo(() => faceRowKinds(rows, collapsedPersons), [rows, collapsedPersons]);
  const rowHeight = useCallback(({ index }: { index: number }) => rowHeightOf(kinds[index] ?? "faces"), [kinds]);
  // The People page's cover of each person, for the headers and the grid of people (#860)
  const ownCovers = usePeopleCovers();
  // Folding swaps a person's header for a cell (and back): the person whose new control takes focus
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

  const renderPerson = useCallback(
    (cell: CompletePersonFace) => (
      // A collapsed person is one cell of a grid of people (#860)
      <PersonCell
        style={PERSON_STYLE}
        person={cell}
        coverUrl={coverFaceUrl(cell, ownCovers.get(cell.id))}
        entrySquareSize={PERSON_CELL}
        onExpand={() => toggleCollapse(cell.id)}
        takeFocus={focusPerson === cell.id}
        onFocused={focusTaken}
      />
    ),
    [ownCovers, toggleCollapse, focusPerson, focusTaken]
  );

  const renderHeader = useCallback(
    (cell: CompletePersonFace) => (
      <HeaderComponent
        style={HEADER_STYLE}
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
          entrySquareSize={entrySquareSize}
        />
      ) : null,
    [
      activeTab,
      entrySquareSize,
      selectedFaces,
      handleCellClick,
      handleShowClick,
      selectMode,
      faceActions,
      pendingFaceIds,
    ]
  );

  // Each row is rendered whole: a shelf of cards, a slice of a wide card or a row of people
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
          group={rowGroups[rowIndex]}
          renderHeader={renderHeader}
          renderFace={renderFace}
          renderPerson={renderPerson}
        />
      );
    },
    [rows, kinds, rowGroups, renderHeader, renderFace, renderPerson]
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
              // One column: the rows lay out their own cards, and stop short of a scrollbar
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
