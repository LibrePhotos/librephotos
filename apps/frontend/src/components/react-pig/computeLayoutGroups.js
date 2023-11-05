// like computeLayout but specific for groups. Could combine them but it might get messy
import getMinAspectRatio from "./utils/getMinAspectRatio";

export default function computeLayoutGroups({ imageData, settings, wrapperWidth, scaleOfImages }) {
  // Compute the minimum aspect ratio that should be applied to the rows.
  const minAspectRatio = getMinAspectRatio(wrapperWidth, scaleOfImages);
  const groupTitleHeight = 50; // wrapperWidth < settings.breakpoint ? 50 : 50

  const tempGroupData = [];
  let translateY = 0;

  imageData.forEach(g => {
    let groupHeight = 0;
    let groupTranslateY = 0;
    let row = []; // The list of images in the current row.
    let translateX = 0; // The current translateX value that we are at
    let rowAspectRatio = 0; // The aspect ratio of the row we are building
    const tempImgData = [];

    // Loop through all our images, building them up into rows and computing
    // the working rowAspectRatio.
    g.items.forEach((image, index) => {
      if (index === 0) {
        groupTranslateY = translateY;
      }
      row.push(image);

      // When the rowAspectRatio exceeeds the minimum acceptable aspect ratio,
      // or when we're out of images, we say that we have all the images we
      // need for that row, and compute the style values for each of these
      // images.
      rowAspectRatio += image.aspectRatio;
      if (rowAspectRatio >= minAspectRatio || index + 1 === g.items.length) {
        // Compute that row's height.
        const totalDesiredWidthOfImages = wrapperWidth - settings.gridGap * (row.length - 1);
        let rowHeight = totalDesiredWidthOfImages / rowAspectRatio;

        // Handles cases where we don't have enough images to fill a row
        if (rowAspectRatio < minAspectRatio) {
          rowHeight = totalDesiredWidthOfImages / minAspectRatio;
        }

        // For each image in the row, compute the width, height, translateX,
        // and translateY values, and set them (and the transition value we
        // found above) on each image.
        //
        // NOTE: that does not manipulate the DOM, rather it just sets the
        //       style values on the ProgressiveImage instance. The DOM nodes
        //       will be updated in doLayout.

        row.forEach(img => {
          const imageWidth = rowHeight * img.aspectRatio;

          tempImgData.push({
            ...img,
            style: {
              width: imageWidth,
              height: rowHeight,
              translateX,
              translateY: translateY + groupTitleHeight,
            },
          });

          // The next image is settings.gridGap pixels to the right of that image
          translateX += Math.round(imageWidth + settings.gridGap);
        });

        // Reset our state variables for next row.
        row = [];
        rowAspectRatio = 0;
        translateX = 0;

        translateY += Math.round(rowHeight + settings.gridGap);
        groupHeight += Math.round(rowHeight + settings.gridGap);
      }
    });

    const groupGap = wrapperWidth < settings.breakpoint ? settings.groupGapSm : settings.groupGapLg;
    translateY += groupGap + groupTitleHeight; // create space between groups to insert the title

    tempGroupData.push({
      ...g,
      groupTranslateY,
      items: tempImgData,
      height: groupHeight + groupTitleHeight,
    });
  });

  // No space below the last image
  const totalHeight = translateY - settings.gridGap;

  return {
    imageData: tempGroupData,
    newTotalHeight: totalHeight,
  };
}
