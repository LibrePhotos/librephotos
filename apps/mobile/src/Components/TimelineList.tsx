import React, { useState, useEffect } from 'react'
import { View } from 'react-native'
import { useDispatch } from 'react-redux'
import { Text } from 'native-base'
import moment from 'moment'
import { useTheme } from '@/Theme'
import { NoResultsError } from '.'
import { PhotoComponent } from './PhotoComponent'
import { LightBox } from './LightBox'
import FetchAlbumDate from '../Store/Album/FetchAlbumDate'
import { FlashList } from '@shopify/flash-list'

type Group = {
  id: string
  page: number
}

const TimelineList = ({ data, onRefresh = () => {}, refreshing = false }) => {
  const { Colors, Gutters } = useTheme()
  const dispatch = useDispatch()

  const [groups, setGroups] = useState([] as Group[])
  const [lightBoxVisible, setLightBoxVisible] = useState(false)
  const [currImage, setCurrImage] = useState({ item: {} })

  // add group.id to all group.data items
  const dataWithIds = data.map(group => {
    return {
      ...group,
      data: group.data.map(item => {
        return { ...item, groupId: group.id }
      }),
    }
  })

  const flatData = dataWithIds.flatMap(group => [group.title, ...group.data])

  useEffect(() => {
    groups.forEach(group => {
      if (group.id && group.page) {
        dispatch(
          FetchAlbumDate.action({
            album_date_id: group.id,
            page: group.page,
            photosetType: 'timestamp',
          }),
        )
      }
    })
  }, [groups, dispatch])

  const handleImagePress = (item, index, section) => {
    const itemInData = data
      .find(i => i.title === item.groupId)
      .data.find(i => i.id === item.id)
    const acutalIndex = data
      .find(i => i.title === item.groupId)
      ?.data.indexOf(itemInData)
    setLightBoxVisible(true)
    setCurrImage({ item, index: acutalIndex, section })
  }

  const onClose = () => {
    setLightBoxVisible(!lightBoxVisible)
  }

  const renderSection = (item: any) => {
    const title =
      item.item === 'No timestamp'
        ? 'No Timestamp'
        : moment(item.item).format('LL')
    const subtitle = moment(item.item).fromNow()
    return (
      <View style={[Gutters.regularHMargin, Gutters.smallVMargin]}>
        <Text fontSize={'xl'} color={Colors.text}>
          {title}
        </Text>
        {item.title !== 'No timestamp' && (
          <Text italic fontSize={'sm'} color={Colors.textMuted}>
            {subtitle}
          </Text>
        )}
      </View>
    )
  }

  const renderPhoto = (input: any) => {
    return <PhotoComponent input={input} handleImagePress={handleImagePress} />
  }

  const onCheckViewableItems = ({ viewableItems }) => {
    getAlbums(viewableItems)
  }

  const getAlbums = visibleElements => {
    const fetchableGroups = [] as Group[]
    const visibleItems = visibleElements.map(i => i.item)
    const tempElements = visibleItems.filter(
      i => i != null && i.isTemp && i.isTemp !== undefined,
    )
    const groupBasedOnId = tempElements.reduce((acc, curr) => {
      if (acc.findIndex(i => i.id === curr.groupId) === -1) {
        acc.push({ id: curr.groupId, data: [curr] })
      } else {
        acc[acc.findIndex(i => i.id === curr.groupId)].data.push(curr)
      }
      return acc
    }, [])

    groupBasedOnId.forEach(item => {
      var visibleImages = item.data
      var firstTempObject = visibleImages.filter(i => i.isTemp)[0]
      var page = Math.ceil((parseInt(firstTempObject.id) + 1) / 100)
      fetchableGroups.push({ id: item.id, page: page })
    })
    setGroups(fetchableGroups)
  }

  return (
    <>
      {flatData && flatData.length > 0 && (
        <View
          style={[
            {
              backgroundColor: Colors.screenBackground,
              width: '100%',
              height: '100%',
            },
          ]}
        >
          <FlashList
            data={flatData}
            onRefresh={onRefresh}
            refreshing={refreshing}
            numColumns={3}
            renderItem={input => {
              if (typeof input.item === 'string' || input.item == null) {
                return renderSection(input)
              } else {
                return renderPhoto(input)
              }
            }}
            overrideItemLayout={(layout, item, index, maxColumns) => {
              if (typeof item === 'string' || item == null) {
                layout.span = maxColumns
              }
            }}
            estimatedItemSize={flatData.length}
            onViewableItemsChanged={onCheckViewableItems}
          />
        </View>
      )}
      {data.length < 1 && (
        <NoResultsError onRefresh={onRefresh} refreshing={refreshing} />
      )}

      <LightBox
        data={data.find(i => i.title === currImage.item.groupId)?.data}
        isVisible={lightBoxVisible}
        currImage={currImage}
        onClose={onClose}
      />
    </>
  )
}

TimelineList.defaultProps = {
  data: [],
}

export default TimelineList
