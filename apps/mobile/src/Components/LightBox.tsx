import React, { useState } from 'react'
import { View, Image, Modal, StyleSheet } from 'react-native'
import ReactNativeZoomableView from '@dudigital/react-native-zoomable-view/src/ReactNativeZoomableView'
import Video from 'react-native-video'
// @ts-ignore - v5 default export
import { useTheme } from '@/Theme'
import { getConfig } from '../Config'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import { UploadButton } from './UploadButton'
import { DownloadButton } from './DownloadButton'
import { useConfigStore } from '@/stores/configStore'
import { useAuthToken } from '@/stores/authStore'

import PagerView from 'react-native-pager-view'

type Input = {
  item: any
  index: number
  arr: any
  setImageZoomed: any
  onClose: any
}

export const LightBoxComponent = (props: Input) => {
  const { item, setImageZoomed, onClose } = props
  const { Layout } = useTheme()
  const authToken = useAuthToken()
  const baseurl = useConfigStore(s => s.baseurl)

  const isVideo = item.type === 'video'
  const mediaUrl = getConfig(baseurl).MEDIA_URL
  const hash = item.url || item.image_hash

  const handleZoomChange = zoomState => {
    if (zoomState.zoomLevel !== 1) {
      setImageZoomed(true)
    } else {
      setImageZoomed(false)
    }
  }

  const imageSource = item.syncStatus
    ? { uri: item.url }
    : {
        uri: mediaUrl + '/thumbnails_big/' + hash,
        method: 'GET',
        headers: { Authorization: 'Bearer ' + authToken },
      }

  return (
    <View style={[Layout.fill]} key={item.id}>
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
          onPress={() => onClose()}
        />
        <UploadButton image={item} />
        <DownloadButton image={item} />
      </View>
      {isVideo && !item.syncStatus ? (
        <View style={[Layout.fullSize, videoStyles.background]}>
          <Video
            source={{
              uri: mediaUrl + '/photos/' + hash + '.mp4',
              headers: { Authorization: 'Bearer ' + authToken },
            }}
            poster={mediaUrl + '/thumbnails_big/' + hash}
            style={Layout.fullSize}
            controls={true}
            resizeMode="contain"
            posterResizeMode="contain"
          />
        </View>
      ) : (
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
          style={[Layout.fullSize, videoStyles.background]}
        >
          <Image
            style={Layout.fullSize}
            source={imageSource}
            resizeMode={'contain'}
          />
        </ReactNativeZoomableView>
      )}
    </View>
  )
}

const videoStyles = StyleSheet.create({
  background: {
    backgroundColor: 'black',
  },
})

type LightBoxProps = {
  data: any
  isVisible: boolean
  currImage: any
  onClose: any
}

export const LightBox = (props: LightBoxProps) => {
  const { Layout } = useTheme()
  const [isImageZoomed, setImageZoomed] = useState(false)
  const { data, isVisible, currImage, onClose } = props

  const renderViewPagerItem = (item, index, arr) => {
    return (
      <LightBoxComponent
        key={item.id}
        item={item}
        index={index}
        arr={arr}
        setImageZoomed={setImageZoomed}
        onClose={onClose}
      />
    )
  }

  return (
    <Modal
      animationType="fade"
      transparent={false}
      visible={isVisible}
      onRequestClose={() => {
        onClose()
      }}
    >
      {currImage && data && data.length > 0 && (
        <PagerView
          style={[Layout.fill]}
          scrollEnabled={!isImageZoomed}
          initialPage={currImage.index}
        >
          {
            // To-Do: This is slow, when there are many images
            data.map(renderViewPagerItem)
          }
        </PagerView>
      )}
    </Modal>
  )
}
