import React from 'react'
import TimelineList from '../../Components/TimelineList'
import { TopBar } from '../../Components'
import LoadingSpinner from '../../Components/LoadingSpinner'
import { useFetchDateAlbumsQuery } from '@/api_client/albums/hooks/useFetchDateAlbumsQuery'
import { useFetchThingsAlbumQuery } from '@/api_client/albums/hooks/useFetchThingsAlbumQuery'
import { useFetchUserAlbumQuery } from '@/api_client/albums/hooks/useFetchUserAlbumQuery'
import { Photoset, type DatePhotosGroup, type IncompleteDatePhotosGroup } from '@/api_client/photos/types'

type AlbumType = 'person' | 'thing' | 'userAlbum'

type TimelineGroup = {
  id: string
  title: string
  data: any[]
  incomplete: boolean
  numberOfItems: number
}

type PhotoListRouteParams = {
  title?: string
  albumType?: AlbumType | string
  albumId?: string | number
}

type Props = {
  route: {
    params: PhotoListRouteParams
  }
}

const mapGroup = (
  group: DatePhotosGroup | IncompleteDatePhotosGroup,
  index: number,
): TimelineGroup => ({
  id: ('id' in group ? group.id : undefined) || `group-${index}`,
  title: group.date || 'No timestamp',
  data: group.items || [],
  incomplete: ('incomplete' in group ? group.incomplete : undefined) || false,
  numberOfItems:
    ('numberOfItems' in group ? group.numberOfItems : undefined) ||
    (group.items || []).length,
})

const PersonPhotos = ({ albumId }: { albumId: string | number }) => {
  const { data, isLoading } = useFetchDateAlbumsQuery({
    photosetType: Photoset.NONE,
    person_id: Number(albumId),
  })
  if (isLoading) return <LoadingSpinner />
  return <TimelineList data={(data || []).map(mapGroup)} />
}

const ThingPhotos = ({ albumId }: { albumId: string | number }) => {
  const { data, isLoading } = useFetchThingsAlbumQuery(String(albumId))
  if (isLoading) return <LoadingSpinner />
  return <TimelineList data={(data?.grouped_photos || []).map(mapGroup)} />
}

const UserAlbumPhotos = ({ albumId }: { albumId: string | number }) => {
  const { data, isLoading } = useFetchUserAlbumQuery(String(albumId))
  if (isLoading) return <LoadingSpinner />
  return <TimelineList data={(data?.grouped_photos || []).map(mapGroup)} />
}

const PhotoListContainer = ({ route: { params } }: Props) => {
  const { title = 'Albums', albumType = '', albumId = '' } = params

  return (
    <>
      <TopBar title={title} showBack={true} />
      {albumType === 'person' && <PersonPhotos albumId={albumId} />}
      {albumType === 'thing' && <ThingPhotos albumId={albumId} />}
      {albumType === 'userAlbum' && <UserAlbumPhotos albumId={albumId} />}
    </>
  )
}

export default PhotoListContainer
