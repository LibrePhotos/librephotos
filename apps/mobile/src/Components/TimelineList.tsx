import React, { useState, useEffect } from 'react'
import { View } from 'react-native'
import { useDispatch } from 'react-redux'
import { Text } from 'native-base'
import moment from 'moment'
import { useTheme } from '@/Theme'
import { NoResultsError } from '.'
import ImageGrid from './ImageGrid'
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

  const renderSection = (item: any) => {
    return (
      <View style={[Gutters.regularHMargin, Gutters.smallVMargin]}>
        <Text fontSize={'xl'} color={Colors.text}>
          {item.title === 'No timestamp'
            ? 'No Timestamp'
            : moment(item.title).format('LL')}
        </Text>
        {item.title !== 'No timestamp' && (
          <Text italic fontSize={'sm'} color={Colors.textMuted}>
            {moment(item.title).fromNow()}
          </Text>
        )}
        <ImageGrid data={item.data} />
      </View>
    )
  }

  const onCheckViewableItems = ({ viewableItems }) => {
    getAlbums(viewableItems)
  }

  const getAlbums = visibleGroups => {
    const fetchableGroups = [] as Group[]
    visibleGroups.forEach(input => {
      var group = input.item
      var visibleImages = group.data
      if (
        visibleImages &&
        visibleImages.filter(i => i.isTemp && i.isTemp !== undefined).length > 0
      ) {
        var firstTempObject = visibleImages.filter(i => i.isTemp)[0]
        var page = Math.ceil((parseInt(firstTempObject.id) + 1) / 100)
        fetchableGroups.push({ id: group.id, page: page })
      }
    })
    setGroups(fetchableGroups)
  }

  return (
    <>
      {data && data.length > 0 && (
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
            data={data}
            onRefresh={onRefresh}
            refreshing={refreshing}
            renderItem={({ item }) => {
              return renderSection(item)
            }}
            estimatedItemSize={data.length}
            onViewableItemsChanged={onCheckViewableItems}
          />
        </View>
      )}
      {data.length < 1 && (
        <NoResultsError onRefresh={onRefresh} refreshing={refreshing} />
      )}
    </>
  )
}

TimelineList.defaultProps = {
  data: [],
}

export default TimelineList
