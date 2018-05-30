export const calculateGridCells = (groupedByDateList,itemsPerRow) => {
    var gridContents = []
    var rowCursor = []
    var hash2row = {}
  
    groupedByDateList.forEach((day)=>{
      gridContents.push([day])
      var currRowIdx = gridContents.length
      day.photos.forEach((photo,idx)=>{
        if (idx === 0 ) {
          rowCursor = []
        }
        if (idx > 0 && idx % itemsPerRow === 0) {
          gridContents.push(rowCursor)
        }
        if (idx % itemsPerRow === 0) {
          rowCursor = []
        }
        rowCursor.push(photo)
        hash2row[[photo.image_hash]] = currRowIdx
        if (idx === day.photos.length-1) {
          gridContents.push(rowCursor)        
        }
  
      })
    })
    return {cellContents:gridContents,hash2row:hash2row}
  }
  

export const calculateGridCellSize = (gridWidth) => {
    var numEntrySquaresPerRow
    
    if (gridWidth < 600) {
        numEntrySquaresPerRow = 2
    } 
    else if (gridWidth < 800) {
        numEntrySquaresPerRow = 3
    }
    else if (gridWidth < 1000) {
        numEntrySquaresPerRow = 5
    }
    else if (gridWidth < 1200) {
        numEntrySquaresPerRow = 7
    }
    else {
        numEntrySquaresPerRow = 8 
    }

    var entrySquareSize = gridWidth / numEntrySquaresPerRow
    var numEntrySquaresPerRow = numEntrySquaresPerRow

    return {
        entrySquareSize: entrySquareSize,
        numEntrySquaresPerRow: numEntrySquaresPerRow
    }

}