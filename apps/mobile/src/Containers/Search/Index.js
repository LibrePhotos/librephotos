import React from 'react'
import { useSelector } from 'react-redux'
import { View } from 'react-native'
import { useTheme } from '@/Theme'
import TimelineList from '../../Components/TimelineList'
import SearchBar from './SearchBar'
import LoadingSpinner from '../../Components/LoadingSpinner'
import StartSearch from './StartSearch'
import { photoMapper } from '@/Services/DataMapper'

const SearchContainer = () => {
  const { Common, Layout } = useTheme()

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
