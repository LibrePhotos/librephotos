import React, { useState, useEffect } from 'react'
import { useSelector } from 'react-redux'
import { Pressable, View, Modal, Image, FlatList } from 'react-native'
import ReactNativeZoomableView from '@dudigital/react-native-zoomable-view/src/ReactNativeZoomableView'
import { useTheme } from '@/Theme'
import { getConfig } from '../Config'
import NoResultsError from './NoResultsError'
import PagerView from 'react-native-pager-view'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import FetchPhotosWithoutDate from '../Store/Album/FetchPhotosWithoutDate'

import { useDispatch } from 'react-redux'
import { UploadButton } from './UploadButton'
import { DownloadButton } from './DownloadButton'
import { FlashList } from '@shopify/flash-list'

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

  const authToken = useSelector(state => state.auth.access?.token)
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
        style={[Common.timeline.photoItem]}
        onPress={() => handleImagePress(item, index, section)}
      >
        {!item.isTemp && (
          <View>
            <Icon
              name={
                item.syncStatus === 'local'
                  ? 'cloud-upload-outline'
                  : item.syncStatus === 'synced'
                  ? 'cloud-check-outline'
                  : 'cloud-outline'
              }
              size={20}
              color={'rgba(0,0,0,0.5)'}
              style={{
                position: 'absolute',
                bottom: 2,
                right: 3,
                zIndex: 1,
              }}
            />
            {
              // To-Do: this is weird but it works
            }
            <Image
              style={{ width: '300%', height: '100%' }}
              source={
                item.syncStatus
                  ? { uri: item.url }
                  : {
                      uri:
                        getConfig(config.baseurl).MEDIA_URL +
                        '/square_thumbnails/' +
                        item.url,
                      method: 'GET',
                      headers: {
                        Authorization: 'Bearer ' + authToken,
                      },
                    }
              }
            />
          </View>
        )}
        {item.isTemp && <View style={Layout.fullSize} />}
      </Pressable>
    )
  }

  const renderViewPagerItem = (item, index, arr) => {
    return (
      <View style={[Layout.fill]} key={index}>
        {
          // add action buttons on the top of the image
        }
        <View
          style={[
            Layout.row,
            Layout.justifyContentSpaceBetween,
            Layout.alignItemsCenter,
            Layout.paddingHorizontal,
            Layout.paddingTop,
            {
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 1,
            },
          ]}
        >
          <Icon.Button
            name={'close'}
            size={20}
            backgroundColor="rgba(52, 52, 52, 0.0)"
            iconStyle={{ marginRight: 0 }}
            onPress={() => setZoomViewVisible(false)}
          />
          <UploadButton image={item} />
          <DownloadButton image={item} />
        </View>
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
            source={
              item.syncStatus
                ? { uri: item.url }
                : {
                    uri:
                      getConfig(config.baseurl).MEDIA_URL +
                      '/thumbnails_big/' +
                      item.url,
                    method: 'GET',
                    headers: {
                      Authorization: 'Bearer ' + authToken,
                    },
                  }
            }
            resizeMode={'contain'}
          />
        </ReactNativeZoomableView>
      </View>
    )
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
    </View>
  )
}

export default ImageGrid
