import React from 'react'
import { ScrollView, View, Pressable } from 'react-native'
import { Box, Image, Text, HStack } from 'native-base'
import Feather from 'react-native-vector-icons/Feather'
import { useTheme } from '@/Theme'
import { useNavigation } from '@react-navigation/native'
import { useAuthToken } from '@/stores/authStore'

type AlbumItem = {
  id: string | number
  title: string
  url: string
}

type AlbumType = 'person' | 'thing' | 'userAlbum'

type PreviewTileProps = {
  icon?: string
  heading: string
  subHeading: string
  albums: AlbumItem[]
  albumType: AlbumType
  iconSuffix?: string
}

const PreviewTile = ({
  icon,
  heading,
  subHeading,
  albums = [],
  albumType,
  iconSuffix = '',
}: PreviewTileProps) => {
  const { Colors, Layout, Common, Gutters } = useTheme()
  const navigation = useNavigation<any>()
  const authToken = useAuthToken()

  const handleItemPress = (item: AlbumItem) => {
    navigation.push('PhotoList', {
      title: item.title,
      albumType,
      albumId: item.id,
    })
  }

  return (
    <View style={[Common.backgroundDefault, Gutters.smallBPadding]}>
      <Pressable
        onPress={() => {
          navigation.push('AlbumList', {
            title: heading,
            albums: albums,
            albumType: albumType,
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
      {albums.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {albums.map((item, index) => (
            <Pressable
              key={item.id ?? index}
              style={[Common.timeline.albumItem]}
              onPress={() => handleItemPress(item)}
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
          ))}
        </ScrollView>
      )}
    </View>
  )
}

export default PreviewTile
