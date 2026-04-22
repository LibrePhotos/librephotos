import React from 'react'
import { View, FlatList, ListRenderItemInfo } from 'react-native'
import { Box, Pressable, Image, Text } from 'native-base'
import { useNavigation } from '@react-navigation/native'
import { useTheme } from '@/Theme'
import { TopBar } from '@/Components'
import { useAuthToken } from '@/stores/authStore'

type AlbumItem = {
  id: string | number
  title: string
  url: string
}

type AlbumType = 'person' | 'thing' | 'userAlbum'

type AlbumListRouteParams = {
  title?: string
  albums?: AlbumItem[]
  albumType?: AlbumType
}

type Props = {
  route: {
    params: AlbumListRouteParams
  }
}

const AlbumListContainer = ({ route: { params } }: Props) => {
  const { title = 'Albums', albums = [], albumType = '' } = params
  const { Common, Colors, Gutters, Layout } = useTheme()
  const navigation = useNavigation<any>()
  const authToken = useAuthToken()

  const handleItemPress = (item: AlbumItem, index: number) => {
    navigation.push('PhotoList', {
      title: albums[index].title,
      albumType,
      albumId: item.id,
    })
  }

  const renderItem = ({ item, index }: ListRenderItemInfo<AlbumItem>) => {
    return (
      <Pressable
        key={index}
        style={[Common.timeline.photoItem]}
        onPress={() => handleItemPress(item, index)}
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
              borderRadius={10}
              onError={() => {}}
            />
          </Box>
          <Text
            textAlign="center"
            style={[Gutters.tinyTMargin]}
            fontSize={'sm'}
            numberOfLines={1}
            color={Colors.text}
          >
            {item.title}
          </Text>
        </View>
      </Pressable>
    )
  }

  return (
    <>
      <TopBar title={title} showBack={true} />
      <FlatList<AlbumItem>
        style={[
          Gutters.smallVPadding,
          { backgroundColor: Colors.screenBackground },
        ]}
        removeClippedSubviews={true}
        data={albums}
        renderItem={renderItem}
        numColumns={3}
        ListFooterComponent={
          <View
            style={[
              Layout.center,
              Gutters.regularTPadding,
              Gutters.largeBPadding,
            ]}
          >
            <Text fontSize="sm" italic color={Colors.textMuted}>
              Thats all folks!
            </Text>
          </View>
        }
      />
    </>
  )
}

export default AlbumListContainer
