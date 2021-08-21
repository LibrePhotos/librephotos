import React from 'react'
import PropTypes from 'prop-types'
import { FlatList, View, Pressable } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import { Image, Text, Badge, VStack, HStack } from 'native-base'
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons'
import { useTheme } from '@/Theme'
import ImageGrid from './ImageGrid'
import { useNavigation } from '@react-navigation/native'

const PreviewTile = ({ icon, heading, subHeading, albums, photos }) => {
  const { Layout, Common, Gutters } = useTheme()
  const navigation = useNavigation()
  const authToken = useSelector(state => state.auth.access.token)

  const handleItemPress = (item, index, section) => {
    photos(item)
    navigation.push('PhotoList', {
      title: item.title,
    })
  }

  const renderItem = ({ item, index, section, seperators }) => {
    return (
      <Pressable
        key={index}
        style={[Common.timeline.albumItem]}
        onPress={() => handleItemPress(item, index, section)}
      >
        <View style={[Layout.center]}>
          <Image
            style={{ width: '85%', height: '80%' }}
            source={{
              uri: item.url,
              method: 'GET',
              headers: {
                Authorization: 'Bearer ' + authToken,
              },
            }}
            alt="Image"
            borderRadius={7}
            // resizeMode={'contain'}
          />
          <Text style={[Gutters.tinyTMargin]} fontSize={'lg'}>
            {item.title}
          </Text>
        </View>
      </Pressable>
    )
  }

  return (
    <View style={[Common.backgroundDefault, Gutters.smallBPadding]}>
      <Pressable
        onPress={() => {
          navigation.push('AlbumList', {
            title: heading,
            albums: albums,
            photos: photos,
          })
        }}
      >
        <HStack style={[Gutters.regularLPadding]}>
          {icon && (
            <View style={[Layout.center]}>
              <MaterialCommunityIcons name={icon} size={40} />
            </View>
          )}
          <View
            style={[
              Gutters.regularLMargin,
              Gutters.smallVMargin,
              { width: '72%' },
            ]}
          >
            <Text fontSize={'2xl'}>{heading}</Text>
            <Text italic>{subHeading}</Text>
          </View>
          <View style={[Layout.center]}>
            <MaterialCommunityIcons name={'chevron-right'} size={40} />
          </View>
        </HStack>
      </Pressable>
      <FlatList
        // refreshing={false}
        // onRefresh={() => {}}
        data={albums}
        renderItem={renderItem}
        horizontal={true}
      />
    </View>
  )
}

export default PreviewTile
