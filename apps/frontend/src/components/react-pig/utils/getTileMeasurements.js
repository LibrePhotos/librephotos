export default ({ item, windowHeight, settings, containerWidth, containerOffsetTop }) => {
  // When expanded, portrait and Landscape images are treated differently
  const isImgPortrait = item.aspectRatio <= 1
  // Based on the window height, calculate the max image width
  const widthDerivedFromMaxWindowHeight = (windowHeight - settings.gridGap * 2) * item.aspectRatio

  const calcWidth = (() => {
    if (isImgPortrait) {
      if (widthDerivedFromMaxWindowHeight > containerWidth) {
        // 1. If image is portrait and when expanded it is too wide to fit in the container width, 
        // return containerWidth (basically a limiter)
        return containerWidth
      } else {
        // 2. If image is portrait and when expanded it fits within the container
        return widthDerivedFromMaxWindowHeight
      }
    } else {
      if ((containerWidth / item.aspectRatio) >= windowHeight) {
        // 3. If it's landscape, and if its too tall to fit in the windowHeight,
        // return the widthDerivedFromMaxWindowHeight
        return widthDerivedFromMaxWindowHeight
      } else {
        // 4. If it's landscape and when expanded fits within the container, return containerWidth
        return containerWidth
      }
    }
  })()

  // Once all of that is out of the way, calculating the height is straightforward;
  const calcHeight = (calcWidth / item.aspectRatio)

  // calculate the offset position in the center of the screen
  const offsetX = (containerWidth / 2) - (calcWidth / 2)
  const offsetY = (typeof window !== 'undefined' ? window.scrollY : 0) + (windowHeight / 2) - (calcHeight / 2) - containerOffsetTop

  return { calcWidth, calcHeight, offsetX, offsetY }
}