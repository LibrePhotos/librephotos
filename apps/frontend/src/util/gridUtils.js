export const calculateGridCells = (groupedByDateList,itemsPerRow) => {
    var gridContents = []
    var rowCursor = []
    var hash2row = {}
  
    groupedByDateList.forEach((day)=>{
      gridContents.push([day])
      var currRowIdx = gridContents.length
      day.photos.forEach((photo,idx)=>{
        if (idx ==0 ) {
          rowCursor = []
        }
        if (idx > 0 && idx % itemsPerRow == 0) {
          gridContents.push(rowCursor)
        }
        if (idx % itemsPerRow == 0) {
          rowCursor = []
        }
        rowCursor.push(photo)
        hash2row[[photo.image_hash]] = currRowIdx
        if (idx == day.photos.length-1) {
          gridContents.push(rowCursor)        
        }
  
      })
    })
    return {cellContents:gridContents,hash2row:hash2row}
  }
  

export const calculateGridCellSize = (gridWidth) => {

    if (gridWidth < 600) {
        var numEntrySquaresPerRow = 3
    } 
    else if (gridWidth < 800) {
        var numEntrySquaresPerRow = 4
    }
    else if (gridWidth < 1000) {
        var numEntrySquaresPerRow = 6
    }
    else if (gridWidth < 1200) {
        var numEntrySquaresPerRow = 6
    }
    else {
        var numEntrySquaresPerRow = 6 
    }

    var entrySquareSize = gridWidth / numEntrySquaresPerRow
    var numEntrySquaresPerRow = numEntrySquaresPerRow

    return {
        entrySquareSize: entrySquareSize,
        numEntrySquaresPerRow: numEntrySquaresPerRow
    }

}