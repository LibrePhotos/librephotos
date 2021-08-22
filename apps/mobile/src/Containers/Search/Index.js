import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { useTheme } from '@/Theme'
import { useTranslation } from 'react-i18next'
import TimelineList from '../../Components/TimelineList'
import SearchBar from './SearchBar'
import LoadingSpinner from '../../Components/LoadingSpinner'
import StartSearch from './StartSearch'
import { photoMapper } from '@/Services/DataMapper'

const SearchContainer = () => {
  const { t } = useTranslation()
  const { Common, Layout } = useTheme()
  const dispatch = useDispatch()
  const navigation = useNavigation()

  const searchState = useSelector(state => state.search)
  const photosByDate = searchState.searchResults?.results || []

  return (
    <>
      <SearchBar />
      {searchState.query && searchState.query.length > 0 ? (
        <View style={[Layout.fill, Common.backgroundDefault]}>
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
