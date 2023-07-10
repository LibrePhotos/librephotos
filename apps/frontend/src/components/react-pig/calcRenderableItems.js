export default function ({
  containerOffsetTop,
  scrollDirection,
  settings,
  latestYOffset,
  imageData,
  windowHeight,
  updateGroups,
  updateItems,
}) {
  // Get the top and bottom buffers heights
  const bufferTop =
    scrollDirection === "up"
      ? settings.primaryImageBufferHeight
      : settings.secondaryImageBufferHeight;
  const bufferBottom =
    scrollDirection === "down"
      ? settings.primaryImageBufferHeight
      : settings.secondaryImageBufferHeight;

  // Now we compute the location of the top and bottom buffers
  // that is the top of the top buffer. If the bottom of an image is above that line, it will be removed.
  const minTranslateYPlusHeight =
    latestYOffset - containerOffsetTop - bufferTop;

  // that is the bottom of the bottom buffer.  If the top of an image is
  // below that line, it will be removed.
  const maxTranslateY = latestYOffset + windowHeight + bufferBottom;

  if (settings.groupByDate) {
    // Here, we loop over every image, determine if it is inside our buffers
    const arrOfGroups = [];
    imageData.forEach((g) => {
      // If the group is not within the buffer then remove it
      if (
        g.groupTranslateY + g.height < minTranslateYPlusHeight ||
        g.groupTranslateY > maxTranslateY
      ) {
        return;
      }
      arrOfGroups.push(g);
    });
    const arrOfGroupsWithOnlyVisibleItems = [];
    arrOfGroups.forEach((g) => {
      const arrOfItems = [];
      g.items.forEach((i) => {
        // If the item is not within the buffer then remove it
        if (
          i.style.translateY + i.style.height < minTranslateYPlusHeight ||
          i.style.translateY > maxTranslateY
        ) {
          return;
        }
        arrOfItems.push(i);
      });
      if (arrOfItems.length > 0) {
        arrOfGroupsWithOnlyVisibleItems.push({
          ...g,
          items: arrOfItems,
        });
      }
    });
    //function to update visible groups
    updateGroups(arrOfGroupsWithOnlyVisibleItems);
    return arrOfGroupsWithOnlyVisibleItems;
  } else {
    var visibleItems = imageData.filter((img) => {
      if (
        img.style.translateY + img.style.height < minTranslateYPlusHeight ||
        img.style.translateY > maxTranslateY
      ) {
        return false;
      } else {
        return true;
      }
    });
    //function to update visible items
    updateItems(visibleItems);
    return visibleItems;
  }
}
