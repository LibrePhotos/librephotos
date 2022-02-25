export const imageGridReducer = sectionData => {
  if (typeof sectionData === 'undefined' || sectionData.length < 1) {
    return []
  }

  let finalmap = sectionData.map((item, index) => {
    return {
      id: item.id,
      url: item.url,
      isTemp: item.isTemp,
    }
  })

  return finalmap
}
