import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ScrollView } from 'native-base'
import { useNavigation } from '@react-navigation/native'
import { useTheme } from '@/Theme'
import { useTranslation } from 'react-i18next'
import { PreviewTile, TopBar } from '../../Components'
import FetchPersonPhotos from '../../Store/Photos/FetchPersonPhotos'
import PopulatePhotos from '../../Store/GalleryList/PopulatePhotos'
import { getConfig } from '../../Config'
import FetchMyAlbumPhotos from '../../Store/Photos/FetchMyAlbumPhotos'

const AlbumContainer = () => {
  const { t } = useTranslation()
  const { Common, Fonts, Gutters, Layout } = useTheme()
  const dispatch = useDispatch()
  const navigation = useNavigation()

  const albumPeople = useSelector(state => state.album.albumPeople.results)
  const albumThings = useSelector(state => state.album.albumThings.results)
  const myAlbums = useSelector(state => state.album.myAlbums.results)
  const config = useSelector(state => state.config)

  const albumPeopleMapper = albumPeopleResult => {
    if (
      typeof albumPeopleResult === 'undefined' ||
      albumPeopleResult.length < 1
    ) {
      return []
    }

    let finalmap = albumPeopleResult.map(item => {
      return {
        id: item.id,
        title: item.name,
        url: config.baseurl + item.face_photo_url.replace('.webp', ''),
      }
    })

    return finalmap
  }

  const myAlbumMapper = myAlbumResult => {
    if (typeof myAlbumResult === 'undefined' || myAlbumResult.length < 1) {
      return []
    }
    console.log(myAlbumResult)
    let finalmap = myAlbumResult.map(item => {
      return {
        id: item.id,
        title: item.title,
        url:
          getConfig(config.baseurl).MEDIA_URL +
          '/square_thumbnails/' +
          item.cover_photos[0].image_hash,
      }
    })
    console.log(finalmap)
    return finalmap
  }

  const albumThingsMapper = albumThingsResult => {
    if (
      typeof albumThingsResult === 'undefined' ||
      albumThingsResult.length < 1
    ) {
      return []
    }

    let finalmap = albumThingsResult.map(item => {
      let photos = item.cover_photos.map((photo, index) => {
        return {
          id: index,
          url: photo.image_hash,
        }
      })

      return {
        id: item.id,
        title: item.title,
        photos: photos,
        url:
          getConfig(config.baseurl).MEDIA_URL +
          '/square_thumbnails/' +
          item.cover_photos[0].image_hash,
      }
    })

    return finalmap
  }

  return (
    <>
      <TopBar />
      <ScrollView>
        <PreviewTile
          icon="people"
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
          icon="library"
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
    </>
  )
}

export default AlbumContainer
