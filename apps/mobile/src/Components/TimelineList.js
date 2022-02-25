import React, { useState, useEffect } from 'react'
import { View, SectionList } from 'react-native'
import { useDispatch } from 'react-redux'
import { Text } from 'native-base'
import moment from 'moment'
import { useTheme } from '@/Theme'
import { NoResultsError } from '.'
import ImageGrid from './ImageGrid'
import FetchAlbumDate from '../Store/Album/FetchAlbumDate'

const TimelineList = ({ data, onRefresh = () => {}, refreshing = false }) => {
  const { Colors, Gutters } = useTheme()
  const dispatch = useDispatch()
  const COLUMNS = 90

  const [group, setGroup] = useState({})

  useEffect(() => {
    if (group.id && group.page) {
      dispatch(
        FetchAlbumDate.action({
          album_date_id: group.id,
          page: group.page,
          photosetType: 'timestamp',
        }),
      )
    }
  }, [group.id, group.page, dispatch])

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

  const onCheckViewableItems = ({ viewableItems, changed }) => {
    getAlbums(viewableItems)
  }

  const getAlbums = visibleGroups => {
    visibleGroups.forEach(input => {
      var group = input.item
      var visibleImages = group.data
      if (
        visibleImages &&
        visibleImages.filter(i => i.isTemp && i.isTemp !== undefined).length > 0
      ) {
        var firstTempObject = visibleImages.filter(i => i.isTemp)[0]
        var page = Math.ceil((parseInt(firstTempObject.id) + 1) / 100)
        setGroup({ id: group.id, page: page })
      }
    })
  }

  const renderSectionListItem = ({ item, index, section, seperators }) => {
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
            itemVisiblePercentThreshold: 50, //means if 50% of the item is visible
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
