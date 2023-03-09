import React from 'react'
import { View } from 'react-native'
import { useGetSettingsQuery } from '../Store/Settings/site-settings'
import { useAppDispatch, useAppSelector } from '../Store/store'
import Icon from 'react-native-vector-icons/Feather'
import { uploadImages } from '../Store/Upload/UploadSlice'
import { Spinner } from 'native-base'

type UploadButtonProps = {
  image: any
}

export function UploadButton(props: UploadButtonProps) {
  const { data: settings } = useGetSettingsQuery()
  const { isUploading } = useAppSelector(state => state.upload)
  const dispatch = useAppDispatch()

  const { image } = props

  const onPress = () => {
    const images = []
    images.push(image)
    dispatch(uploadImages(images))
    image.syncStatus = 'synced'
  }
  if (settings?.allow_upload && image.syncStatus == 'local') {
    return (
      <View>
        {!isUploading && (
          <Icon.Button
            backgroundColor="rgba(52, 52, 52, 0.0)"
            iconStyle={{ marginRight: 0 }}
            name={'upload'}
            size={20}
            onPress={onPress}
          />
        )}
        {isUploading && <Spinner size={20} />}
      </View>
    )
  } else {
    return null
  }
}
