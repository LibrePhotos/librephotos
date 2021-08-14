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
import { PreviewTile, TopBar } from '../../Components'
import ImageGrid from '../../Components/ImageGrid'
import FetchPersonPhotos from '../../Store/Photos/FetchPersonPhotos'
import PopulatePhotos from '../../Store/GalleryList/PopulatePhotos'

const AlbumContainer = () => {
  const { t } = useTranslation()
  const { Common, Fonts, Gutters, Layout } = useTheme()
  const dispatch = useDispatch()
  const navigation = useNavigation()

  const albumPeople = useSelector(state => state.album.albumPeople.results)
  const albumThings = useSelector(state => state.album.albumThings.results)

  const albumPeopleMapper = albumPeopleResult => {
    if (
      typeof albumPeopleResult === 'undefined' ||
      albumPeopleResult.length < 1
    ) {
      return []
    }

    let finalmap = albumPeopleResult.map(item => {
      return {
        id: item.id,
        title: item.name,
        url: item.face_photo_url,
      }
    })

    return finalmap
  }

  const albumThingsMapper = albumThingsResult => {
    if (
      typeof albumThingsResult === 'undefined' ||
      albumThingsResult.length < 1
    ) {
      return []
    }


    let finalmap = albumThingsResult.map(item => {
      let photos = item.cover_photos.map((photo, index) => {
        return {
          id: index,
          url: photo.image_hash,
        }
      })

      return {
        id: item.id,
        title: item.title,
        photos: photos,
        url: '/square_thumbnails/' + item.cover_photos[0].image_hash,
      }
    })

    return finalmap
  }

  return (
    <>
      <TopBar />
      <PreviewTile
        icon="account-multiple"
        heading="People"
        subHeading={`about ${albumPeople?.length} people`}
        albums={albumPeopleMapper(albumPeople)}
        photos={item => {
          dispatch(FetchPersonPhotos.action({ id: item.id }))
        }}
      />
      <PreviewTile
        icon="map"
        heading="Places"
        subHeading={`about ${albumPeople.length} places`}
        albums={albumPeopleMapper(albumPeople)}
      />
      <PreviewTile
        icon="label-multiple"
        heading="Things"
        subHeading={`about ${albumThings?.length} things`}
        albums={albumThingsMapper(albumThings)}
        photos={item => {
          console.log('Things', item)
          dispatch(PopulatePhotos.action({ gridPhotos: item.photos }))
        }}
      />
    </>
  )
}

export default AlbumContainer
