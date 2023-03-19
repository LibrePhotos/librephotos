import React, { useState } from 'react'
import { View, Image, Modal } from 'react-native'
import ReactNativeZoomableView from '@dudigital/react-native-zoomable-view/src/ReactNativeZoomableView'
import { useTheme } from '@/Theme'
import { getConfig } from '../Config'
import Icon from 'react-native-vector-icons/MaterialCommunityIcons'
import { UploadButton } from './UploadButton'
import { DownloadButton } from './DownloadButton'
import { useAppSelector } from '@/Store/store'

import PagerView from 'react-native-pager-view'

type Input = {
  item: any
  index: number
  arr: any
  setImageZoomed: any
  onClose: any
}

export const LightBoxComponent = (props: Input) => {
  const { item, index, setImageZoomed, onClose } = props
  const { Layout } = useTheme()
  const authToken = useAppSelector(state => state.auth.access?.token)
  const config = useAppSelector(state => state.config)

  const handleZoomChange = zoomState => {
    if (zoomState.zoomLevel !== 1) {
      setImageZoomed(true)
    } else {
      setImageZoomed(false)
    }
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
