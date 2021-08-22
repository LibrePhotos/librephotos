import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigation } from '@react-navigation/native'
import { useTheme } from '@/Theme'
import { useTranslation } from 'react-i18next'
import TimelineList from '../../Components/TimelineList'
import { TopBar } from '../../Components'
import ImageGrid from '../../Components/ImageGrid'
import LoadingSpinner from '../../Components/LoadingSpinner'

const PhotoListContainer = ({
  route: {
    params: { title = 'Albums' },
  },
}) => {
  const { t } = useTranslation()
  const { Common, Fonts, Gutters, Layout } = useTheme()
  const dispatch = useDispatch()
  const navigation = useNavigation()

  const gallerylist = useSelector(state => state.gallerylist)

  return (
    <>
      <TopBar title={title} showBack={true} />
      {!gallerylist.loading ? (
        gallerylist.lastLoaded === 'timeline' ? (
          <TimelineList data={gallerylist.timelinePhotos} />
        ) : (
          <ImageGrid data={gallerylist.gridPhotos} displayError={true} />
        )
      ) : (
        <LoadingSpinner />
      )}
    </>
  )
}

export default PhotoListContainer
