import React, { useEffect, useState } from 'react'
import { RefreshControl } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import { ScrollView } from 'native-base'
import { LoadingSpinner, PreviewTile, TopBar } from '@/Components'
import FetchPersonPhotos from '@/Store/Photos/FetchPersonPhotos'
import FetchMyAlbumPhotos from '@/Store/Photos/FetchMyAlbumPhotos'
import PopulatePhotos from '@/Store/GalleryList/PopulatePhotos'
import FetchPeople from '@/Store/Album/FetchPeople'
import FetchThings from '@/Store/Album/FetchThings'
import FetchMyAlbums from '@/Store/Album/FetchMyAlbums'
import {
  albumPeopleMapper,
  albumThingsMapper,
  myAlbumMapper,
} from '@/Services/DataMapper'
import ClearAlbumData from '../../Store/Album/ClearAlbumData'

const AlbumContainer = () => {
  const dispatch = useDispatch()

  const [initialLoading, setInitialLoading] = useState(true)

  const albumPeople = useSelector(state => state.album.albumPeople?.results)
  const albumThings = useSelector(state => state.album.albumThings?.results)
  const myAlbums = useSelector(state => state.album.myAlbums?.results)
  const isLoading = useSelector(state => state.album.loading)

  const handleRefresh = () => {
    return Promise.all([
      dispatch(FetchMyAlbums.action()),
      dispatch(FetchPeople.action()),
      dispatch(FetchThings.action()),
    ])
  }

  useEffect(() => {
    handleRefresh().then(() => setInitialLoading(false))
    return () => {
      dispatch(ClearAlbumData.action())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <TopBar />
      {initialLoading ? (
        <LoadingSpinner />
      ) : (
        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={isLoading === true}
              onRefresh={handleRefresh}
            />
          }
        >
          <PreviewTile
            icon="users"
            heading="People"
            subHeading={`about ${albumPeople?.length} people`}
            albums={albumPeopleMapper(albumPeople)}
            photos={item => {
              dispatch(FetchPersonPhotos.action({ id: item.id }))
            }}
          />
          {/* <PreviewTile
          icon="map"
          heading="Places"
          subHeading={`about ${albumPeople.length} places`}
          albums={albumPeopleMapper(albumPeople)}
        /> */}
          <PreviewTile
            icon="book"
            heading="Things"
            subHeading={`about ${albumThings?.length} things`}
            albums={albumThingsMapper(albumThings)}
            photos={item => {
              dispatch(PopulatePhotos.action({ gridPhotos: item.photos }))
            }}
          />
          <PreviewTile
            icon="bookmark"
            heading="My Albums"
            subHeading={`about ${myAlbums?.length} albums`}
            albums={myAlbumMapper(myAlbums)}
            photos={item => {
              dispatch(FetchMyAlbumPhotos.action({ id: item.id }))
            }}
          />
        </ScrollView>
      )}
    </>
  )
}

export default AlbumContainer
