import React, { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  View,
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native'
import { Button, Badge, HStack } from 'native-base'
import { useNavigation } from '@react-navigation/native'
import { Brand } from '@/Components'
import { useTheme } from '@/Theme'
import FetchOne from '@/Store/User/FetchOne'
import { useTranslation } from 'react-i18next'
import ChangeTheme from '@/Store/Theme/ChangeTheme'
import LogoutUser from '@/Store/Auth/LogoutUser'
import FetchAlbumByDate from '@/Store/Album/FetchByDate'
import TimelineList from '../../Components/TimelineList'
import { TopBar } from '../../Components'
import ImageGrid from '../../Components/ImageGrid'

const GalleryContainer = () => {
  const { t } = useTranslation()
  const { Common, Fonts, Gutters, Layout } = useTheme()
  const dispatch = useDispatch()
  const navigation = useNavigation()

  const photosByDate = useSelector(state => state.album.albumByDate.results)
  const photosWithoutDate = useSelector(
    state => state.album.albumWithoutDate.results,
  )

  const photoMapper = photosResult => {
    if (typeof photosResult === 'undefined' || photosResult.length < 1) {
      return []
    }

    let finalmap = photosResult.map(item => {
      return {
        id: item.date,
        title: item.date,
        data: item.items,
      }
    })

    return finalmap
  }

  const [showPhotosByDate, setPhotosByDate] = useState(true)

  return (
    <>
      <TopBar />
      <View style={[Common.backgroundDefault, Layout.colCenter]}>
        <HStack
          space={{
            base: 3,
            md: 4,
          }}
          mx={{
            base: 5,
            md: 0,
          }}
          my={{
            base: 2,
            md: 0,
          }}
          style={[Common.backgroundDefault]}
        >
          <Button
            size="xs"
            variant={showPhotosByDate ? 'solid' : 'outline'}
            colorScheme="dark"
            onPress={() => setPhotosByDate(true)}
          >
            With Timestamp
          </Button>
          <Button
            size="xs"
            variant={!showPhotosByDate ? 'solid' : 'outline'}
            colorScheme="dark"
            onPress={() => setPhotosByDate(false)}
          >
            Without Timestamp
          </Button>
        </HStack>
      </View>
      <View style={[Layout.fill, Layout.colCenter, Common.backgroundDefault]}>
        {showPhotosByDate ? (
          <TimelineList data={photoMapper(photosByDate)} />
        ) : (
          <ImageGrid
            data={photosWithoutDate}
            numColumns={3}
            displayError={true}
          />
        )}
      </View>
    </>
  )
}

export default GalleryContainer
