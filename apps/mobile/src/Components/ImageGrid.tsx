import React, { useState, useEffect, useRef } from 'react'
import { View, ViewToken } from 'react-native'
import NoResultsError from './NoResultsError'
import { FlashList, ListRenderItemInfo } from '@shopify/flash-list'
import { PhotoComponent } from './PhotoComponent'
import { LightBox } from './LightBox'

type PhotoItem = {
  id: string
  url?: string
  isTemp?: boolean
  [key: string]: any
}

type ImageGridProps = {
  data?: PhotoItem[]
  numColumns?: number
  displayError?: boolean
  onRefresh?: () => void
  refreshing?: boolean
  onFetchPage?: (page: number) => void
}

type PageGroup = {
  page?: number
}

type CurrImage = {
  item: PhotoItem | Record<string, never>
  index?: number
  section?: any
}

const ImageGrid = ({
  data,
  numColumns = 3,
  displayError = false,
  onRefresh = () => {},
  refreshing = false,
  onFetchPage,
}: ImageGridProps) => {
  const COLUMNS = numColumns

  const [lightBoxVisible, setLightBoxVisible] = useState(false)
  const [currImage, setCurrImage] = useState<CurrImage>({ item: {} })

  const handleImagePress = (item: PhotoItem, index: number, section: any) => {
    setLightBoxVisible(true)
    setCurrImage({ item, index, section })
  }

  const onClose = () => {
    setLightBoxVisible(!lightBoxVisible)
  }

  const [group, setGroup] = useState<PageGroup>({})

  useEffect(() => {
    if (group.page && onFetchPage) {
      onFetchPage(group.page)
    }
  }, [group.page, onFetchPage])

  const renderPhoto = (input: ListRenderItemInfo<PhotoItem>) => {
    return <PhotoComponent input={input} handleImagePress={handleImagePress} />
  }

  const getImages = (visibleItems: ViewToken[]) => {
    const tempItems = visibleItems.filter(
      i => i.item?.isTemp && i.item.isTemp !== undefined,
    )
    if (tempItems.length > 0) {
      const firstTempObject = tempItems[0]
      const page = Math.ceil((parseInt(firstTempObject.item.id, 10) + 1) / 100)
      if (page > 1) {
        setGroup({ page })
      }
    }
  }

  const onViewRef = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      getImages(viewableItems)
    },
  )
  const viewConfigRef = useRef({ viewAreaCoveragePercentThreshold: 50 })

  return (
    <View style={{ height: '100%', width: '100%' }}>
      {data && data.length > 0 && (
        <FlashList
          refreshing={refreshing}
          onRefresh={onRefresh}
          keyExtractor={(_item: PhotoItem, index: number) => String(index)}
          numColumns={COLUMNS}
          data={data}
          renderItem={renderPhoto}
          estimatedItemSize={data.length}
          onViewableItemsChanged={onViewRef.current}
          viewabilityConfig={viewConfigRef.current}
        />
      )}
      {(!Array.isArray(data) || data.length < 1) && displayError && (
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
