import React from 'react'
import PropTypes from 'prop-types'
import { View, Image, FlatList, SectionList } from 'react-native'
import { Text } from 'native-base'
import { useDispatch, useSelector } from 'react-redux'
import { useTheme } from '@/Theme'

const TimelineList = ({ data, height, width, mode }) => {
  const { Layout, Images } = useTheme()
  const authToken = useSelector(state => state.auth.access.token)

  const COLUMNS = 3

  // console.log("data", data[0])

  const renderSectionHeader = ({ section: { data, title } }) => {
    return (
      <>
        <Text fontSize={'2xl'}>{title}</Text>
        <Text italic>Count: {data.length}</Text>
      </>
    )
  }

  const renderPhoto = ({ item, index, section, seperators }) => {
    return (
      <Image
        style={{ width: '32%', height: 140, margin: 2 }}
        source={{
          uri:
            'http://cloud.akshay-naik.com:3000/media/square_thumbnails/' +
            item.url,
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
      <Text>Hello</Text>
      <SectionList
        renderItem={renderSectionListItem}
        renderSectionHeader={renderSectionHeader}
        sections={data}
      />
    </>
    // <View style={{ height, width }}>
    //   <Image style={Layout.fullSize} source={Images.logo} resizeMode={mode} />
    // </View>
  )
}

// TimelineList.propTypes = {
// }

TimelineList.defaultProps = {
  data: [],
}

export default TimelineList
