const gridType = "dense";

/**
 * The rows of a grid of groups: each group gets a header row holding just the
 * group, followed by rows of up to `itemsPerRow` of its items.
 */
export type GroupedGridRows<Group, Item> = Array<[Group] | Item[]>;

export const calculateSharedAlbumGridCells = <Group extends { albums: readonly unknown[] }>(
  groupedBySharerList: readonly Group[],
  itemsPerRow: number
): { cellContents: GroupedGridRows<Group, Group["albums"][number]> } => {
  const gridContents: GroupedGridRows<Group, Group["albums"][number]> = [];
  let rowCursor: Group["albums"][number][] = [];

  groupedBySharerList.forEach(group => {
    gridContents.push([group]);
    group.albums.forEach((album, idx) => {
      if (idx === 0) {
        rowCursor = [];
      }
      if (idx > 0 && idx % itemsPerRow === 0) {
        gridContents.push(rowCursor);
      }
      if (idx % itemsPerRow === 0) {
        rowCursor = [];
      }
      rowCursor.push(album);
      if (idx === group.albums.length - 1) {
        gridContents.push(rowCursor);
      }
    });
  });
  return { cellContents: gridContents };
};

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

export const calculateFaceGridCells = <Person extends { id: number; faces: readonly unknown[] }>(
  groupedByPersonList: readonly Person[],
  itemsPerRow: number,
  collapsedPersonIds: ReadonlySet<number> = new Set()
): { cellContents: GroupedGridRows<Person, Person["faces"][number]> } => {
  const gridContents: GroupedGridRows<Person, Person["faces"][number]> = [];
  let rowCursor: Person["faces"][number][] = [];

  groupedByPersonList.forEach(person => {
    gridContents.push([person]);
    // A collapsed person is reduced to its header row, so every consumer of the
    // flattened cell array (row count, scrubber, lazy page loader) shrinks with it
    if (collapsedPersonIds.has(person.id)) {
      return;
    }
    person.faces.forEach((face, idx) => {
      if (idx === 0) {
        rowCursor = [];
      }
      if (idx > 0 && idx % itemsPerRow === 0) {
        gridContents.push(rowCursor);
      }
      if (idx % itemsPerRow === 0) {
        rowCursor = [];
      }
      rowCursor.push(face);
      if (idx === person.faces.length - 1) {
        gridContents.push(rowCursor);
      }
    });
  });
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
