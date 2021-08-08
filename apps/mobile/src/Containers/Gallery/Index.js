import React, { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  View,
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Brand } from '@/Components'
import { useTheme } from '@/Theme'
import FetchOne from '@/Store/User/FetchOne'
import { useTranslation } from 'react-i18next'
import ChangeTheme from '@/Store/Theme/ChangeTheme'
import LogoutUser from '@/Store/Auth/LogoutUser'
import FetchAlbumByDate from '@/Store/Album/FetchByDate'
import TimelineList from '../../Components/TimelineList'

const GalleryContainer = () => {
  const { t } = useTranslation()
  const { Common, Fonts, Gutters, Layout } = useTheme()
  const dispatch = useDispatch()
  const navigation = useNavigation()

  const photos = useSelector(state => state.album.albumByDate.results)

  const photoMapper = photosResult => {
    let finalmap = photosResult.map(item => {
      return {
        title: item.date,
        data: item.items,
      }
    })

    console.log(finalmap)

    return finalmap
  }

  const [userId, setUserId] = useState('1')

  const fetch = id => {
    setUserId(id)
    if (id) {
      dispatch(FetchOne.action(id))
    }
  }

  const changeTheme = ({ theme, darkMode }) => {
    dispatch(ChangeTheme.action({ theme, darkMode }))
  }

  const logout = () => {
    dispatch(LogoutUser.action())
    navigation.navigate('Login')
  }

  const loadPhotos = () => {
    dispatch(FetchAlbumByDate.action())
  }

  return (
    <View style={[Layout.fill, Layout.colCenter]}>
      <TimelineList data={photoMapper(photos)} />
    </View>
  )
}

export default GalleryContainer
