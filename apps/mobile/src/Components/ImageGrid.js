import React, { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { Pressable, View, Modal, Image, FlatList } from 'react-native'
import ReactNativeZoomableView from '@dudigital/react-native-zoomable-view/src/ReactNativeZoomableView'
import { useTheme } from '@/Theme'
import { getConfig } from '../Config'
import NoResultsError from './NoResultsError'
import { updateToken } from '../Services/Auth'
import PagerView from 'react-native-pager-view'
import reactotron from 'reactotron-react-native'
import FetchPhotosWithoutDate from '../Store/Album/FetchPhotosWithoutDate'

import { useDispatch } from 'react-redux'
const ImageGrid = ({
  data,
  numColumns = 3,
  displayError = false,
  onRefresh = () => {},
  refreshing = false,
}) => {
  const { Common, Layout } = useTheme()

  const [zoomViewVisible, setZoomViewVisible] = useState(false)
  const [isImageZoomed, setImageZoomed] = useState(false)
  const [currImage, setCurrImage] = useState({ item: {} })

  const authToken = useSelector(state => state.auth.access.token)
  const config = useSelector(state => state.config)

  const dispatch = useDispatch()

  const COLUMNS = numColumns // Currently only columns=3 supported

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

  const handleImagePress = (item, index, section) => {
    setZoomViewVisible(true)
    setCurrImage({ item, index, section })
  }

  const handleImageLoadFail = () => {
    updateToken()
  }

  const handleZoomChange = (evt, gestureState, zoomState) => {
    if (zoomState.zoomLevel !== 1) {
      setImageZoomed(true)
    } else {
      setImageZoomed(false)
    }
  }

  const renderPhoto = ({ item, index, section, seperators }) => {
    return (
      <Pressable
        key={index}
        style={[Common.timeline.photoItem]}
        onPress={() => handleImagePress(item, index, section)}
      >
        <Image
          style={Layout.fullSize}
          source={{
            uri:
              getConfig(config.baseurl).MEDIA_URL +
              '/square_thumbnails/' +
              item.url,
            method: 'GET',
            headers: {
              Authorization: 'Bearer ' + authToken,
            },
          }}
          onError={handleImageLoadFail}
        />
      </Pressable>
    )
  }

  const renderViewPagerItem = (item, index, arr) => {
    return (
      <View style={[Layout.fill]} key={index}>
        <ReactNativeZoomableView
          maxZoom={2}
          minZoom={1}
          zoomStep={0.5}
          initialZoom={1}
          pinchToZoomInSensitivity={1}
          zoomCenteringLevelDistance={3}
          movementSensibility={1.3}
          bindToBorders={true}
          captureEvent={true}
          doubleTapZoomToCenter={true}
          onDoubleTapAfter={handleZoomChange}
          onZoomEnd={handleZoomChange}
          style={[
            Layout.fullSize,
            // eslint-disable-next-line react-native/no-inline-styles
            {
              backgroundColor: 'black',
            },
          ]}
        >
          <Image
            style={Layout.fullSize}
            source={{
              uri:
                getConfig(config.baseurl).MEDIA_URL +
                '/thumbnails_big/' +
                item.url,
              method: 'GET',
              headers: {
                Authorization: 'Bearer ' + authToken,
              },
            }}
            resizeMode={'contain'}
            onError={handleImageLoadFail}
          />
        </ReactNativeZoomableView>
      </View>
    )
  }

  const getImages = visibleItems => {
    reactotron.log(visibleItems)
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
    <>
      {data && data.length > 0 && (
        <FlatList
          refreshing={refreshing}
          onRefresh={onRefresh}
          keyExtractor={(item, index) => index}
          numColumns={COLUMNS}
          data={data}
          renderItem={renderPhoto}
          //To-Do: Broken!
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

      <Modal
        animationType="fade"
        transparent={false}
        visible={zoomViewVisible}
        onRequestClose={() => {
          setZoomViewVisible(!zoomViewVisible)
        }}
      >
        <PagerView
          style={[Layout.fill]}
          scrollEnabled={!isImageZoomed}
          initialPage={currImage.index}
        >
          {data && data.length > 0 && data.map(renderViewPagerItem)}
        </PagerView>
      </Modal>
    </>
  )
}

export default ImageGrid
