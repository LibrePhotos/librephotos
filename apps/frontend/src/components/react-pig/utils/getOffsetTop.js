
//   /**
//    * Returns the distance from `elem` to the top of the page. This is done by
//    * walking up the node tree, getting the offsetTop of each parent node, until
//    * the top of the page.
//    *
//    * @param {object} elem - The element to compute the offset of.
//    **/
// export default function (elem) {
//   let offsetTop = 0
//   do {
//     if (!isNaN(elem.offsetTop)){
//       offsetTop += elem.offsetTop
//     }
//     elem = elem.offsetParent
//   } while(elem)
//   return offsetTop
// }