import React from 'react'
import PropTypes from 'prop-types'
import { View, SectionList } from 'react-native'
import { Text } from 'native-base'
import moment from 'moment'
import { useTheme } from '@/Theme'
import { NoResultsError } from '.'
import ImageGrid from './ImageGrid'

const TimelineList = ({ data, height, width, mode }) => {
  const { Colors, Gutters } = useTheme()

  const COLUMNS = 3

  const renderSectionHeader = ({ section: { data, title } }) => {
    return (
      <View style={[Gutters.regularHMargin, Gutters.smallVMargin]}>
        <Text fontSize={'2xl'}>{moment(title).format('LL')}</Text>
        <Text italic>{moment(title).fromNow()}</Text>
      </View>
    )
  }

  const renderSectionListItem = ({ item, index, section, seperators }) => {
    if (index % COLUMNS !== 0) {
      return null
    }

    return <ImageGrid data={section.data} numColumns={3} />
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
