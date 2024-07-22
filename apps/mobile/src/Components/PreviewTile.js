import React from 'react'
import { FlatList, View, Pressable } from 'react-native'
import { useSelector } from 'react-redux'
import { Box, Image, Text, HStack } from 'native-base'
import Feather from 'react-native-vector-icons/Feather'
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
  const authToken = useSelector(state => state.auth.access?.token)

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
              style={[Layout.fullSize]}
              source={{
                uri: item.url,
                method: 'GET',
                headers: {
                  Authorization: 'Bearer ' + authToken,
                },
              }}
              alt="Image"
              borderRadius={7}
            />
          </Box>
          <Text
            style={[Gutters.tinyTMargin]}
            fontSize={'lg'}
            color={Colors.text}
          >
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
              <Feather name={icon + iconSuffix} size={35} color={Colors.text} />
            </View>
          )}
          <View
            style={[
              Gutters.regularLMargin,
              Gutters.smallVMargin,
              Common.timeline.photoContainer,
            ]}
          >
            <Text fontSize={'xl'} color={Colors.text}>
              {heading}
            </Text>
            <Text italic fontSize={'sm'} color={Colors.textMuted}>
              {subHeading}
            </Text>
          </View>
          <View style={[Layout.center]}>
            <Feather name={'chevron-right'} size={35} color={Colors.text} />
          </View>
        </HStack>
      </Pressable>
      <FlatList
        // refreshing={false}
        // onRefresh={() => {}}
        showsHorizontalScrollIndicator={false}
        data={albums}
        renderItem={renderItem}
        horizontal={true}
      />
    </View>
  )
}

export default PreviewTile
