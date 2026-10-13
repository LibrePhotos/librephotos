const gridType = "dense";

/**
 * The rows of a grid of groups: an open group gets a header row holding just the group, followed
 * by rows of up to `itemsPerRow` of its items. Folded groups share rows of up to `itemsPerRow`
 * groups, one cell each.
 */
export type GroupedGridRows<Group, Item> = Array<Group[] | Item[]>;

export const calculateGridCellSize = (gridWidth: number) => {
  let numEntrySquaresPerRow: number;

  if (gridType === "dense") {
    if (gridWidth < 600) {
      numEntrySquaresPerRow = 2;
    } else if (gridWidth < 800) {
      numEntrySquaresPerRow = 3;
    } else if (gridWidth < 1000) {
      numEntrySquaresPerRow = 5;
    } else if (gridWidth < 1200) {
      numEntrySquaresPerRow = 7;
    } else if (gridWidth < 1400) {
      numEntrySquaresPerRow = 9;
    } else if (gridWidth < 1600) {
      numEntrySquaresPerRow = 11;
    } else if (gridWidth < 1800) {
      numEntrySquaresPerRow = 13;
    } else if (gridWidth < 2000) {
      numEntrySquaresPerRow = 15;
    } else if (gridWidth < 2200) {
      numEntrySquaresPerRow = 17;
    } else {
      numEntrySquaresPerRow = 19;
    }
  } else if (gridWidth < 600) {
    numEntrySquaresPerRow = 1;
  } else if (gridWidth < 800) {
    numEntrySquaresPerRow = 2;
  } else if (gridWidth < 1000) {
    numEntrySquaresPerRow = 3;
  } else if (gridWidth < 1200) {
    numEntrySquaresPerRow = 4;
  } else if (gridWidth < 1400) {
    numEntrySquaresPerRow = 5;
  } else if (gridWidth < 1600) {
    numEntrySquaresPerRow = 6;
  } else if (gridWidth < 1800) {
    numEntrySquaresPerRow = 7;
  } else if (gridWidth < 2000) {
    numEntrySquaresPerRow = 6;
  } else if (gridWidth < 2200) {
    numEntrySquaresPerRow = 9;
  } else {
    numEntrySquaresPerRow = 10;
  }

  const entrySquareSize = gridWidth / numEntrySquaresPerRow;

  return { entrySquareSize, numEntrySquaresPerRow };
};

/** Splits a list into rows of at most `perRow` (at least one per row). */
function chunkRows<T>(items: readonly T[], perRow: number): T[][] {
  const size = Math.max(1, perRow);
  const rows: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    rows.push(items.slice(start, start + size));
  }
  return rows;
}

/**
 * The faces grid's rows. An expanded person is a header row and rows of their faces. A collapsed
 * person is a single cell, and collapsed people next to each other share rows, so "Collapse all"
 * turns the dashboard into a grid of people (#860). A collapsed person's faces are left out
 * entirely, so every consumer of the flattened cell array (row count, scrubber, lazy page loader)
 * shrinks with it.
 */
export const calculateFaceGridCells = <Person extends { id: number; faces: readonly unknown[] }>(
  groupedByPersonList: readonly Person[],
  itemsPerRow: number,
  collapsedPersonIds: ReadonlySet<number> = new Set()
): { cellContents: GroupedGridRows<Person, Person["faces"][number]> } => {
  const gridContents: GroupedGridRows<Person, Person["faces"][number]> = [];
  let collapsedRun: Person[] = [];
  const flushCollapsedRun = () => {
    gridContents.push(...chunkRows(collapsedRun, itemsPerRow));
    collapsedRun = [];
  };

  groupedByPersonList.forEach(person => {
    if (collapsedPersonIds.has(person.id)) {
      collapsedRun.push(person);
      return;
    }
    flushCollapsedRun();
    gridContents.push([person], ...chunkRows(person.faces, itemsPerRow));
  });
  flushCollapsedRun();
  return { cellContents: gridContents };
};

export const calculateFaceGridCellSize = (gridWidth: number) => {
  let numEntrySquaresPerRow = 10;
  if (gridWidth < 300) {
    numEntrySquaresPerRow = 2;
  } else if (gridWidth < 600) {
    numEntrySquaresPerRow = 3;
  } else if (gridWidth < 800) {
    numEntrySquaresPerRow = 4;
  } else if (gridWidth < 1000) {
    numEntrySquaresPerRow = 6;
  } else if (gridWidth < 1200) {
    numEntrySquaresPerRow = 8;
  }

  const entrySquareSize = gridWidth / numEntrySquaresPerRow;

  return { entrySquareSize, numEntrySquaresPerRow };
};
