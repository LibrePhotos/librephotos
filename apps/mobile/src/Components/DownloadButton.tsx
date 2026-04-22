import React from 'react'
import { View } from 'react-native'
import { useConfigStore } from '../stores/configStore'
import { useAuthStore } from '../stores/authStore'
import Icon from 'react-native-vector-icons/Feather'
import ReactNativeBlobUtil from 'react-native-blob-util'

type DownloadButtonProps = {
  image: any
}

export function DownloadButton(props: DownloadButtonProps): JSX.Element | null {
  const baseurl = useConfigStore(s => s.baseurl)
  const access = useAuthStore(s => s.access)
  const { image } = props

  const onPress = async (): Promise<void> => {
    let image_url = baseurl + '/media/photos/' + image.id
    await ReactNativeBlobUtil.config({
      fileCache: true,
    })
      .fetch('GET', image_url, {
        Authorization: 'Bearer ' + access?.token,
      })
      .then(async res => {
        let result = await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
          {
            name: image.id + '.jpg',
            parentFolder: '',
            mimeType: 'image/jpg',
          },
          'Image',
          res.path(),
        )
        console.log('Image downloaded successfully.')
        return result
      })
      .catch(err => {
        console.log("Couldn't download image: " + err)
      })
    image.syncStatus = 'synced'
  }

  if (!image.syncStatus) {
    return (
      <View>
        <Icon.Button
          backgroundColor="rgba(52, 52, 52, 0.0)"
          iconStyle={{ marginRight: 0 }}
          name={'download'}
          size={20}
          onPress={onPress}
        />
      </View>
    )
  } else {
    return null
  }
}
