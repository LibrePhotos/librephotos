import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { View } from 'react-native'
import { Button, HStack } from 'native-base'
import { useTheme } from '@/Theme'
import FetchAlbumByDate from '@/Store/Album/FetchByDate'
import FetchPhotosWithoutDate from '@/Store/Album/FetchPhotosWithoutDate'
import TimelineList from '../../Components/TimelineList'
import { TopBar } from '../../Components'
import ImageGrid from '../../Components/ImageGrid'

const GalleryContainer = () => {
  const { Common, Layout } = useTheme()
  const dispatch = useDispatch()

  const albums = useSelector(state => state.album)
  const albumByDate = useSelector(state => state.album.albumByDate)
  const albumWithoutDate = useSelector(state => state.album.albumWithoutDate)
  const photosByDate = albumByDate?.results
  const photosWithoutDate = albumWithoutDate?.results

  useEffect(() => {
    handleAlbumWithoutDateRefresh()
    handleAlbumWithDateRefresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleAlbumWithoutDateRefresh = () => {
    dispatch(FetchPhotosWithoutDate.action())
  }

  const handleAlbumWithDateRefresh = () => {
    dispatch(FetchAlbumByDate.action())
  }

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
          <TimelineList
            data={photoMapper(photosByDate)}
            onRefresh={handleAlbumWithDateRefresh}
            refreshing={albums.loading}
          />
        ) : (
          <ImageGrid
            data={photosWithoutDate}
            numColumns={3}
            displayError={true}
            onRefresh={handleAlbumWithoutDateRefresh}
            refreshing={albums.loading}
          />
        )}
      </View>
    </>
  )
}

export default GalleryContainer
