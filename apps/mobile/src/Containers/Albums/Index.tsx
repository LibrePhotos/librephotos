import React from 'react'
import { RefreshControl } from 'react-native'
import { ScrollView } from 'native-base'
import { LoadingSpinner, PreviewTile, TopBar } from '@/Components'
import { useFetchPeopleAlbumsQuery } from '@/api_client/albums/hooks/useFetchPeopleAlbumsQuery'
import { useFetchThingsAlbumsQuery } from '@/api_client/albums/hooks/useFetchThingsAlbumsQuery'
import { useFetchUserAlbumsQuery } from '@/api_client/albums/hooks/useFetchUserAlbumsQuery'
import { getConfig } from '@/Config'
import { useConfigStore } from '@/stores/configStore'

const AlbumContainer = () => {
  const baseurl = useConfigStore(s => s.baseurl)
  const mediaUrl = getConfig(baseurl).MEDIA_URL

  const {
    data: albumPeople,
    isLoading: peopleLoading,
    refetch: refetchPeople,
  } = useFetchPeopleAlbumsQuery()
  const {
    data: albumThings,
    isLoading: thingsLoading,
    refetch: refetchThings,
  } = useFetchThingsAlbumsQuery()
  const {
    data: myAlbums,
    isLoading: albumsLoading,
    refetch: refetchAlbums,
  } = useFetchUserAlbumsQuery()

  const isLoading = peopleLoading || thingsLoading || albumsLoading
  const initialLoading = peopleLoading && !albumPeople

  const handleRefresh = () => {
    refetchPeople()
    refetchThings()
    refetchAlbums()
  }

  const mappedPeople = (albumPeople || []).map(person => ({
    id: person.id,
    title: person.name,
    url: person.face_url
      ? person.face_url.startsWith('http')
        ? person.face_url
        : baseurl + person.face_url
      : '',
  }))

  const mappedThings = (albumThings || []).map(thing => ({
    id: thing.id,
    title: thing.title,
    url: thing.cover_photos?.[0]?.image_hash
      ? mediaUrl + '/square_thumbnails/' + thing.cover_photos[0].image_hash
      : '',
  }))

  const mappedAlbums = (myAlbums || []).map(album => ({
    id: album.id,
    title: album.title,
    url: album.cover_photo?.image_hash
      ? mediaUrl + '/square_thumbnails/' + album.cover_photo.image_hash
      : '',
  }))

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
            subHeading={`about ${albumPeople?.length || 0} people`}
            albums={mappedPeople}
            albumType="person"
          />
          <PreviewTile
            icon="book"
            heading="Things"
            subHeading={`about ${albumThings?.length || 0} things`}
            albums={mappedThings}
            albumType="thing"
          />
          <PreviewTile
            icon="bookmark"
            heading="My Albums"
            subHeading={`about ${myAlbums?.length || 0} albums`}
            albums={mappedAlbums}
            albumType="userAlbum"
          />
        </ScrollView>
      )}
    </>
  )
}

export default AlbumContainer
