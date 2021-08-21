import React from 'react'
import PropTypes from 'prop-types'
import { View, SectionList } from 'react-native'
import { Text } from 'native-base'
import moment from 'moment'
import { useTheme } from '@/Theme'
import { NoResultsError } from '.'
import ImageGrid from './ImageGrid'

const TimelineList = ({ data }) => {
  const { Colors, Gutters } = useTheme()

  const COLUMNS = 3

  const renderSectionHeader = ({ section: { data, title } }) => {
    return (
      <View key={title} style={[Gutters.regularHMargin, Gutters.smallVMargin]}>
        <Text fontSize={'xl'}>
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
          removeClippedSubviews={true}
          style={[{ backgroundColor: Colors.screenBackground }]}
          renderItem={renderSectionListItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item, index) => index}
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
