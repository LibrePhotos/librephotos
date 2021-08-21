import React, { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  View,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
} from 'react-native'
import { Pressable, Image, Text, HStack } from 'native-base'
import { useNavigation } from '@react-navigation/native'
import { Brand } from '@/Components'
import { useTheme } from '@/Theme'
import FetchOne from '@/Store/User/FetchOne'
import { useTranslation } from 'react-i18next'
import ChangeTheme from '@/Store/Theme/ChangeTheme'
import LogoutUser from '@/Store/Auth/LogoutUser'
import FetchAlbumByDate from '@/Store/Album/FetchByDate'
import TimelineList from '../../Components/TimelineList'
import { PreviewTile, TopBar } from '../../Components'
import ImageGrid from '../../Components/ImageGrid'
import FetchPersonPhotos from '../../Store/Photos/FetchPersonPhotos'

const AlbumListContainer = ({
  route: {
    params: { title = 'Albums', albums = [], photos = () => null },
  },
}) => {
  const { t } = useTranslation()
  const { Common, Fonts, Gutters, Layout } = useTheme()
  const dispatch = useDispatch()
  const navigation = useNavigation()
  const authToken = useSelector(state => state.auth.access.token)

  const handleItemPress = (item, index, section) => {
    photos(item)
    // dispatch(FetchPersonPhotos.action({ id: albums[index].id }))
    navigation.push('PhotoList', {
      title: albums[index].title,
    })
    // setZoomViewVisible(true)
    // setCurrImage({ item, index, section })
  }

  const renderItem = ({ item, index, section, seperators }) => {
    return (
      <Pressable
        key={index}
        style={[Common.timeline.photoItem]}
        onPress={() => handleItemPress(item, index, section)}
      >
        <View style={[Layout.center]}>
          <Image
            style={{ width: '80%', height: '80%' }}
            source={{
              uri: item.url,
              method: 'GET',
              headers: {
                Authorization: 'Bearer ' + authToken,
              },
            }}
            alt="Image"
            borderRadius={10}
            // resizeMode={'contain'}
          />
          <Text
            textAlign="center"
            style={[Gutters.tinyTMargin]}
            fontSize={'sm'}
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
      <FlatList
        style={[Gutters.smallVPadding]}
        // refreshing={false}
        // onRefresh={() => {}}
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
            <Text fontSize="sm" italic>
              Thats all folks!
            </Text>
          </View>
        }
      />
    </>
  )
}

export default AlbumListContainer
