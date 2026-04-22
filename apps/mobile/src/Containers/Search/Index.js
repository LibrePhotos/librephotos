import React, { useState } from 'react'
import { View } from 'react-native'
import { useTheme } from '@/Theme'
import TimelineList from '../../Components/TimelineList'
import SearchBar from './SearchBar'
import LoadingSpinner from '../../Components/LoadingSpinner'
import StartSearch from './StartSearch'
import { useSearchPhotosQuery } from '@/api_client/search/hooks/useSearchPhotosQuery'

const SearchContainer = () => {
  const { Common, Layout } = useTheme()

  const [searchTerm, setSearchTerm] = useState('')
  const { data: searchResults, isLoading } = useSearchPhotosQuery(searchTerm)

  // Transform to the format expected by TimelineList
  const photosByDate = (searchResults?.photosGroupedByDate || []).map(
    group => ({
      id: group.date,
      title: group.date,
      data: group.items || [],
      incomplete: false,
      numberOfItems: group.items?.length || 0,
    }),
  )

  return (
    <>
      <SearchBar
        searchTerm={searchTerm}
        onSearch={setSearchTerm}
        onClear={() => setSearchTerm('')}
      />
      {searchTerm && searchTerm.length > 0 ? (
        <View style={[Layout.fill, Common.backgroundDefault]}>
          {!isLoading ? (
            <TimelineList data={photosByDate} />
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
