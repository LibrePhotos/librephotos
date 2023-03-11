import React, { useState, useEffect } from 'react'
import { View, SectionList } from 'react-native'
import { useDispatch } from 'react-redux'
import { Text } from 'native-base'
import moment from 'moment'
import { useTheme } from '@/Theme'
import { NoResultsError } from '.'
import ImageGrid from './ImageGrid'
import FetchAlbumDate from '../Store/Album/FetchAlbumDate'

type Group = {
  id: string
  page: number
}

const TimelineList = ({ data, onRefresh = () => {}, refreshing = false }) => {
  const { Colors, Gutters } = useTheme()
  const dispatch = useDispatch()
  const COLUMNS = 90

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

  const renderSectionHeader = ({ section: { title } }) => {
    return (
      <View key={title} style={[Gutters.regularHMargin, Gutters.smallVMargin]}>
        <Text fontSize={'xl'} color={Colors.text}>
          {title === 'No timestamp'
            ? 'No Timestamp'
            : moment(title).format('LL')}
        </Text>
        {title !== 'No timestamp' && (
          <Text italic fontSize={'sm'} color={Colors.textMuted}>
            {moment(title).fromNow()}
          </Text>
        )}
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

  const renderSectionListItem = ({ index, section }) => {
    if (index % COLUMNS !== 0) {
      return null
    }

    return (
      <ImageGrid
        data={section.data.slice(index, index + COLUMNS)}
        // data={item}
        numColumns={3}
      />
    )
  }

  return (
    <>
      {data && data.length > 0 && (
        <SectionList
          onRefresh={onRefresh}
          refreshing={refreshing}
          removeClippedSubviews={true}
          style={[{ backgroundColor: Colors.screenBackground }]}
          renderItem={renderSectionListItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item, index) => index}
          sections={data}
          onViewableItemsChanged={onCheckViewableItems}
          viewabilityConfig={{
            waitForInteraction: false,
            itemVisiblePercentThreshold: 1,
          }}
        />
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
