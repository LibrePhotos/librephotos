import React, { useState, useEffect } from 'react'
import { View } from 'react-native'
import NoResultsError from './NoResultsError'
import FetchPhotosWithoutDate from '../Store/Album/FetchPhotosWithoutDate'

import { useDispatch } from 'react-redux'
import { FlashList } from '@shopify/flash-list'
import { PhotoComponent } from './PhotoComponent'
import { LightBox } from './LightBox'

const ImageGrid = ({
  data,
  numColumns = 3,
  displayError = false,
  onRefresh = () => {},
  refreshing = false,
}) => {
  const dispatch = useDispatch()

  const COLUMNS = numColumns // Currently only columns=3 supported

  const [lightBoxVisible, setLightBoxVisible] = useState(false)
  const [currImage, setCurrImage] = useState({ item: {} })

  const handleImagePress = (item, index, section) => {
    setLightBoxVisible(true)
    setCurrImage({ item, index, section })
  }

  const onClose = () => {
    setLightBoxVisible(!lightBoxVisible)
  }

  const [group, setGroup] = useState({})

  useEffect(() => {
    if (group.page) {
      dispatch(
        FetchPhotosWithoutDate.action({
          page: group.page,
        }),
      )
    }
  }, [group.page, dispatch])

  const renderPhoto = input => {
    console.log(input)
    return <PhotoComponent input={input} handleImagePress={handleImagePress} />
  }

  const getImages = visibleItems => {
    if (
      visibleItems.filter(i => i.item.isTemp && i.item.isTemp != undefined)
        .length > 0
    ) {
      var firstTempObject = visibleItems.filter(i => i.item.isTemp)[0]
      var page = Math.ceil((parseInt(firstTempObject.item.id) + 1) / 100)
      if (page > 1) {
        setGroup({ page: page })
      }
    }
  }

  const onViewRef = React.useRef(input => {
    getImages(input.viewableItems)
  })
  const viewConfigRef = React.useRef({ viewAreaCoveragePercentThreshold: 50 })

  return (
    <View style={{ height: '100%', width: '100%' }}>
      {data && data.length > 0 && (
        <FlashList
          refreshing={refreshing}
          onRefresh={onRefresh}
          keyExtractor={(item, index) => index}
          numColumns={COLUMNS}
          data={data}
          renderItem={renderPhoto}
          estimatedItemSize={data.length}
          onViewableItemsChanged={onViewRef.current}
          viewabilityConfig={viewConfigRef.current}
        />
      )}
      {(typeof data !== 'object' ||
        typeof data.length === 'undefined' ||
        data.length < 1) &&
        displayError && (
          <NoResultsError refreshing={refreshing} onRefresh={onRefresh} />
        )}

      <LightBox
        data={data}
        isVisible={lightBoxVisible}
        currImage={currImage}
        onClose={onClose}
      />
    </View>
  )
}

export default ImageGrid
