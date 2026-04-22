import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { View } from 'react-native'
import { Button, HStack, ScrollView } from 'native-base'
import { useTheme } from '@/Theme'
import { useFetchDateAlbumsQuery } from '@/api_client/albums'
import { DateAlbumsQueryKeys } from '@/api_client/albums/hooks/useFetchDateAlbumsQuery'
import { fetchClient, queryClient } from '@/api_client/api'
import { useFetchPhotosWithoutTimestampQuery } from '@/api_client/photos/hooks/useFetchPhotosWithoutTimestampQuery'
import { useFetchRecentlyAddedPhotosQuery } from '@/api_client/photos/hooks/useFetchRecentlyAddedPhotosQuery'
import { Photoset } from '@/api_client/photos/types'
import TimelineList from '@/Components/TimelineList'
import { TopBar } from '@/Components'
import ImageGrid from '@/Components/ImageGrid'
import { SyncStatus } from '@/stores/types/localImages.zod'
import { useLocalImagesStore } from '@/stores/localImagesStore'
import { loadLocalImages } from '@/stores/localImagesActions'

const CategoryType = {
  PhotosByDate: 'With Timestamp',
  PhotosWithoutDate: 'Without Timestamp',
  Recent: 'Recently Added',
  Favourite: 'Favourites',
  Videos: 'Videos',
  Public: 'Public Photos',
  Hidden: 'Hidden',
}

const GalleryContainer = () => {
  const { Common, Layout } = useTheme()

  const [category, setCategory] = useState(CategoryType.PhotosByDate)

  // React Query hooks for each category
  const photosetType = useMemo(() => {
    switch (category) {
      case CategoryType.PhotosByDate:
        return Photoset.TIMESTAMP
      case CategoryType.Favourite:
        return Photoset.FAVORITES
      case CategoryType.Videos:
        return Photoset.VIDEOS
      case CategoryType.Public:
        return Photoset.PUBLIC
      case CategoryType.Hidden:
        return Photoset.HIDDEN
      default:
        return Photoset.TIMESTAMP
    }
  }, [category])

  const useTimeline =
    category === CategoryType.PhotosByDate ||
    category === CategoryType.Favourite ||
    category === CategoryType.Videos ||
    category === CategoryType.Public ||
    category === CategoryType.Hidden

  const {
    data: dateAlbums,
    isLoading: dateAlbumsLoading,
    refetch: refetchDateAlbums,
  } = useFetchDateAlbumsQuery(
    { photosetType },
  )

  const {
    data: photosWithoutDate,
    isLoading: noDateLoading,
    refetch: refetchNoDate,
  } = useFetchPhotosWithoutTimestampQuery(1)

  const {
    data: recentlyAdded,
    isLoading: recentLoading,
    refetch: refetchRecent,
  } = useFetchRecentlyAddedPhotosQuery()

  // Local images from Zustand
  const localImages = useLocalImagesStore(s => s.images)

  useEffect(() => {
    if (category === CategoryType.PhotosByDate) {
      loadLocalImages()
    }
  }, [category])

  const isLoading =
    (useTimeline && dateAlbumsLoading) ||
    (category === CategoryType.PhotosWithoutDate && noDateLoading) ||
    (category === CategoryType.Recent && recentLoading)

  // Track fetched/in-flight pages to prevent duplicate requests
  const fetchedPagesRef = useRef(new Set())

  // Clear the dedup set when category changes
  useEffect(() => {
    fetchedPagesRef.current.clear()
  }, [photosetType])

  // Callback for TimelineList to lazy-load album date pages when temp elements become visible
  const handleFetchPage = useCallback(
    async (albumDateId, page) => {
      const key = `${albumDateId}:${page}`
      if (fetchedPagesRef.current.has(key)) {
        return
      }
      fetchedPagesRef.current.add(key)

      try {
        // Build filter params matching useFetchDateAlbumsQuery
        const params = {
          page: String(page),
          favorite: Photoset.FAVORITES === photosetType ? 'true' : undefined,
          public: Photoset.PUBLIC === photosetType ? 'true' : undefined,
          hidden: Photoset.HIDDEN === photosetType ? 'true' : undefined,
          video: Photoset.VIDEOS === photosetType ? 'true' : undefined,
        }
        const qs = Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => `${k}=${v}`)
          .join('&')
        const response = await fetchClient.get(
          `/albums/date/${albumDateId}/?${qs}`,
        )
        const result = response.results
        // Update the dateAlbums cache so the component re-renders with real data
        // Key must match useFetchDateAlbumsQuery exactly (includes undefined trailing params)
        const dateAlbumsQueryKey = [...DateAlbumsQueryKeys, photosetType, undefined, undefined, undefined]
        const oldData = queryClient.getQueryData(dateAlbumsQueryKey)
        if (oldData && result) {
          const newData = [...oldData]
          const idx = newData.findIndex(g => g.id === albumDateId)
          if (idx !== -1) {
            const group = { ...newData[idx] }
            group.items = group.items
              .slice(0, (page - 1) * 100)
              .concat(result.items)
              .concat(group.items.slice(page * 100))
            newData[idx] = group
            queryClient.setQueryData(dateAlbumsQueryKey, newData)
          }
        }
      } catch (err) {
        fetchedPagesRef.current.delete(key)
        console.error('[Gallery] Failed to fetch album date page', err)
      }
    },
    [photosetType],
  )

  const renderButton = (index, buttonCategory) => {
    return (
      <Button
        key={index}
        size="xs"
        variant={category === buttonCategory ? 'solid' : 'outline'}
        colorScheme="dark"
        onPress={() => setCategory(buttonCategory)}
      >
        {buttonCategory}
      </Button>
    )
  }

  // Transform dateAlbums to the format expected by TimelineList, merging local images
  const timelineData = useMemo(() => {
    if (!dateAlbums) {
      return []
    }
    // Map the frontend format to mobile's expected format
    let mapped = (dateAlbums || []).map(group => ({
      id: group.id,
      title: group.date,
      data: [...(group.items || [])],
      incomplete: group.numberOfItems > 0,
      numberOfItems: group.numberOfItems || 0,
    }))

    // Merge local images for PhotosByDate category
    if (category === CategoryType.PhotosByDate && localImages) {
      localImages.forEach(photo => {
        const date = photo.birthTime
        const index = mapped.findIndex(x => x.title === date)
        if (index === -1) {
          mapped = [
            ...mapped,
            {
              id: date,
              title: date,
              data: [photo],
              incomplete: false,
              numberOfItems: 1,
            },
          ]
          mapped.sort((a, b) => new Date(b.title) - new Date(a.title))
        } else {
          const albumDate = mapped[index]
          albumDate.data = [
            ...albumDate.data.filter(i => i.id !== photo.id),
            photo,
          ].sort((a, b) => new Date(b.date) - new Date(a.date))
          if (photo.syncStatus === SyncStatus.LOCAL) {
            albumDate.numberOfItems += 1
          }
        }
      })
      // Remove temp elements for synced local images
      mapped.forEach(albumDate => {
        const syncedCount = albumDate.data.filter(
          p => p.syncStatus === SyncStatus.SYNCED,
        ).length
        const tempElements = albumDate.data
          .filter(p => p.isTemp === true)
          .slice(0, syncedCount)
        albumDate.data = albumDate.data.filter(
          p => tempElements.indexOf(p) === -1,
        )
      })
    }

    return mapped
  }, [category, dateAlbums, localImages])

  const renderContent = () => {
    switch (category) {
      case CategoryType.PhotosByDate:
        return (
          <TimelineList
            data={timelineData}
            onRefresh={() => refetchDateAlbums()}
            refreshing={isLoading}
            onFetchPage={handleFetchPage}
          />
        )
      case CategoryType.PhotosWithoutDate:
        return (
          <ImageGrid
            data={photosWithoutDate?.results}
            numColumns={3}
            displayError={true}
            onRefresh={() => refetchNoDate()}
            refreshing={isLoading}
          />
        )
      case CategoryType.Recent:
        return (
          <ImageGrid
            data={recentlyAdded?.results}
            numColumns={3}
            displayError={true}
            onRefresh={() => refetchRecent()}
            refreshing={isLoading}
          />
        )
      case CategoryType.Favourite:
      case CategoryType.Videos:
      case CategoryType.Public:
      case CategoryType.Hidden:
        return (
          <TimelineList
            data={timelineData}
            onRefresh={() => refetchDateAlbums()}
            refreshing={isLoading}
            onFetchPage={handleFetchPage}
          />
        )
    }
  }

  return (
    <>
      <TopBar />
      <View style={[Common.backgroundDefault, Layout.colCenter]}>
        <ScrollView horizontal={true} showsHorizontalScrollIndicator={false}>
          <HStack
            space={{ base: 3, md: 4 }}
            mx={{ base: 5, md: 0 }}
            my={{ base: 2, md: 0 }}
            style={[Common.backgroundDefault]}
          >
            {Object.values(CategoryType).map((buttonCategory, index) =>
              renderButton(index, buttonCategory),
            )}
          </HStack>
        </ScrollView>
      </View>
      <View style={[Layout.fill, Common.backgroundDefault]}>
        {renderContent()}
      </View>
    </>
  )
}

export default GalleryContainer
