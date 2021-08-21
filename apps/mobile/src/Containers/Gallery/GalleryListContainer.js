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
import TimelineList from '../../Components/TimelineList'
import { PreviewTile, TopBar } from '../../Components'
import ImageGrid from '../../Components/ImageGrid'
import FetchPersonPhotos from '../../Store/Photos/FetchPersonPhotos'

const GalleryListContainer = ({
  route: {
    params: { title = 'Albums' },
  },
}) => {
  const { t } = useTranslation()
  const { Common, Fonts, Gutters, Layout } = useTheme()
  const dispatch = useDispatch()
  const navigation = useNavigation()
  // const photoState = useSelector(state => state.photos)

  // const photosArray = useSelector(state => state.photos.personPhotos)
  const gallerylist = useSelector(state => state.gallerylist)

  return (
    <>
      <TopBar title={title} showBack={true} />
      {/* <ImageGrid data={photos} displayError={true} /> */}
      {gallerylist.lastLoaded === 'timeline' ? (
        <TimelineList data={gallerylist.timelinePhotos} />
      ) : (
        <ImageGrid data={gallerylist.gridPhotos} displayError={true} />
      )}
    </>
  )
}

export default GalleryListContainer
