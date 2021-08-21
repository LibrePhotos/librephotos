import React from 'react'
import { FlatList, View, Pressable } from 'react-native'
import { useSelector } from 'react-redux'
import { Box, Image, Text, HStack } from 'native-base'
import Ionicons from 'react-native-vector-icons/Ionicons'
import { useTheme } from '@/Theme'
import { useNavigation } from '@react-navigation/native'

const PreviewTile = ({
  icon,
  heading,
  subHeading,
  albums,
  photos,
  iconSuffix = '',
}) => {
  const { Colors, Layout, Common, Gutters } = useTheme()
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
          <Box
            shadow={5}
            bg={Colors.screenBackground}
            borderRadius={10}
            boxSize={'80%'}
          >
            <Image
              style={{ width: '100%', height: '100%' }}
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
          </Box>
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
              <Ionicons name={icon + iconSuffix} size={35} />
            </View>
          )}
          <View
            style={[
              Gutters.regularLMargin,
              Gutters.smallVMargin,
              { width: '72%' },
            ]}
          >
            <Text fontSize={'xl'}>{heading}</Text>
            <Text italic fontSize={'sm'} color={Colors.textMuted}>
              {subHeading}
            </Text>
          </View>
          <View style={[Layout.center]}>
            <Ionicons name={'chevron-forward'} size={35} />
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
