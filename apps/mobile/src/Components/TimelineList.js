import React from 'react'
import PropTypes from 'prop-types'
import { View, Image, FlatList, SectionList } from 'react-native'
import { Text } from 'native-base'
import { useDispatch, useSelector } from 'react-redux'
import moment from 'moment'
import { useTheme } from '@/Theme'
import { Config } from '../Config'
import { NoResultsError } from '.'

const TimelineList = ({ data, height, width, mode }) => {
  const { Common, Colors, Layout, Gutters } = useTheme()
  const authToken = useSelector(state => state.auth.access.token)

  const COLUMNS = 3

  const renderSectionHeader = ({ section: { data, title } }) => {
    return (
      <View style={[Gutters.regularHMargin, Gutters.smallVMargin]}>
        <Text fontSize={'2xl'}>{moment(title).format('LL')}</Text>
        <Text italic>{moment(title).fromNow()}</Text>
      </View>
    )
  }

  const renderPhoto = ({ item, index, section, seperators }) => {
    return (
      <Image
        style={[Common.timeline.photoItem]}
        source={{
          uri: Config.MEDIA_URL + '/square_thumbnails/' + item.url,
          method: 'GET',
          headers: {
            Authorization: 'Bearer ' + authToken,
          },
        }}
        // resizeMode={'contain'}
      />
    )
  }

  const renderSectionListItem = ({ item, index, section, seperators }) => {
    if (index % COLUMNS !== 0) {
      return null
    }

    return (
      <FlatList
        numColumns={COLUMNS}
        data={section.data}
        renderItem={renderPhoto}
      />
    )
  }

  return (
    <>
      {data && data.length > 0 && (
        <SectionList
          style={[{ backgroundColor: Colors.screenBackground }]}
          renderItem={renderSectionListItem}
          renderSectionHeader={renderSectionHeader}
          sections={data}
        />
      )}
      {data.length < 1 && <NoResultsError />}
    </>
  )
}

// TimelineList.propTypes = {
// }

TimelineList.defaultProps = {
  data: [],
}

export default TimelineList
