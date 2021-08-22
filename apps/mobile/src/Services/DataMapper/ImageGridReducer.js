export const imageGridReducer = sectionData => {
  if (typeof sectionData === 'undefined' || sectionData.length < 1) {
    return []
  }

  let finalmap = sectionData.map((item, index) => {
    return {
      id: index,
      url: item.url,
    }
  })

  return finalmap
}
