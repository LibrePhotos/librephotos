import React from 'react'
import { View } from 'react-native'
import { useGetSettingsQuery } from '../Store/Settings/site-settings'
import { useAppDispatch, useAppSelector } from '../Store/store'
import Icon from 'react-native-vector-icons/Feather'
import { uploadImages } from '../Store/Upload/UploadSlice'
import { Spinner } from 'native-base'

/**
 * Props for UploadButton component
 */
type UploadButtonProps = {
  /**
   * The image to be uploaded
   */
  image: any
}

/**
 * Component to display an upload button for an image
 * @param props The props for the component
 * @returns {JSX.Element|null} The UploadButton component or null if the image is already uploaded
 */
export function UploadButton(props: UploadButtonProps) {
  const { data: settings } = useGetSettingsQuery()
  const { isUploading } = useAppSelector(state => state.upload)
  const dispatch = useAppDispatch()

  const { image } = props

  /**
   * Handler for the upload button press event
   */
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
