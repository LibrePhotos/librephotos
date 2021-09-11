import React from 'react'
import { useSelector } from 'react-redux'
import TimelineList from '../../Components/TimelineList'
import { TopBar } from '../../Components'
import ImageGrid from '../../Components/ImageGrid'
import LoadingSpinner from '../../Components/LoadingSpinner'

const PhotoListContainer = ({
  route: {
    params: { title = 'Albums' },
  },
}) => {
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
