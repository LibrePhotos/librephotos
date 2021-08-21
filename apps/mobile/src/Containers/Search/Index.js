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
import SearchBar from './SearchBar'
import ImageGrid from '../../Components/ImageGrid'
import LoadingSpinner from '../../Components/LoadingSpinner'
import StartSearch from './StartSearch'

const SearchContainer = () => {
  const { t } = useTranslation()
  const { Common, Fonts, Gutters, Layout } = useTheme()
  const dispatch = useDispatch()
  const navigation = useNavigation()

  const searchState = useSelector(state => state.search)
  const photosByDate = searchState.searchResults?.results || []

  const imageGridMapper = sectionData => {
    if (typeof sectionData === 'undefined' || sectionData.length < 1) {
      return []
    }

    let finalmap = sectionData.map(item => {
      return {
        url: item.url,
      }
    })

    return finalmap
  }

  const photoMapper = photosResult => {
    if (typeof photosResult === 'undefined' || photosResult.length < 1) {
      return []
    }

    let finalmap = photosResult.map(item => {
      return {
        id: item.date,
        title: item.date,
        data: imageGridMapper(item.items),
      }
    })

    return finalmap
  }

  return (
    <>
      <SearchBar />
      {searchState.query && searchState.query.length > 0 ? (
        <View style={[Layout.fill, Layout.colCenter, Common.backgroundDefault]}>
          {!searchState.loading ? (
            <TimelineList data={photoMapper(photosByDate)} />
          ) : (
            <LoadingSpinner />
          )}
        </View>
      ) : (
        <StartSearch />
      )}
    </>
  )
}

export default SearchContainer
