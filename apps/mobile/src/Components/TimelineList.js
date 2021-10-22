import React from 'react'
import { View, SectionList } from 'react-native'
import { Text } from 'native-base'
import moment from 'moment'
import { useTheme } from '@/Theme'
import { NoResultsError } from '.'
import ImageGrid from './ImageGrid'

const TimelineList = ({ data, onRefresh = () => {}, refreshing = false }) => {
  const { Colors, Gutters } = useTheme()

  const COLUMNS = 90

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
        />
      )}
      {data.length < 1 && (
        <NoResultsError onRefresh={onRefresh} refreshing={refreshing} />
      )}
    </>
  )
}

// TimelineList.propTypes = {
// }

TimelineList.defaultProps = {
  data: [],
}

export default TimelineList
