import { createFileRoute } from '@tanstack/react-router'
import { IconGlobe as Globe } from '@tabler/icons-react'
import React, { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { fetchClient } from '../../api_client/api'
import { UserAlbum } from '../../api_client/albums/types'
import { PhotoListView } from '../../components/photolist/PhotoListView'
import { getPhotosFlatFromGroupedByDate } from '../../util/util'

export const Route = createFileRoute('/public/s/$slug')({
  component: PublicAlbumBySlug,
})

function PublicAlbumBySlug() {
  const { slug } = Route.useParams()

  const { data: album, isLoading } = useQuery({
    queryKey: ['publicAlbumBySlug', slug],
    queryFn: async () => {
      const response = await fetchClient.get<any>(`/public/albums/s/${slug}/`)
      return UserAlbum.parse(response.results)
    },
  })

  const flat = useMemo(
    () => (album ? getPhotosFlatFromGroupedByDate(album.grouped_photos) : []),
    [album]
  )

  return (
    <PhotoListView
      title={album ? album.title : 'Loading'}
      loading={isLoading}
      icon={<Globe size={50} />}
      photoset={album ? album.grouped_photos : []}
      idx2hash={flat}
      isPublic
      selectable
    />
  )
}

