import React from 'react'
import { View } from 'react-native'
import { useAppDispatch, useAppSelector } from '../Store/store'
import Icon from 'react-native-vector-icons/Feather'
import { Spinner } from 'native-base'
import ReactNativeBlobUtil from 'react-native-blob-util'

type DownloadButtonProps = {
  image: any
}

export function DownloadButton(props: DownloadButtonProps) {
  const { baseurl } = useAppSelector(state => state.config)
  const { access } = useAppSelector(state => state.auth)

  const { image } = props

  const onPress = async () => {
    let image_url = baseurl + '/media/photos/' + image.id
    console.log('Downloading image: ' + image.id)
    console.log('Downloading image from: ' + image_url)
    await ReactNativeBlobUtil.config({
      fileCache: true,
    })
      .fetch(
        'GET',
        image_url,
        {
          Authorization: 'Bearer ' + access.token,
          Accept: 'application/octet-stream',
        },
        JSON.stringify(dat),
      )
      .then(async res => {
        console.log(res)
        console.log('Image downloaded to: ' + res.path())
        let result = await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
          {
            name: image.id + '.jpg', // name of the file
            parentFolder: '', // subdirectory in the Media Store, e.g. HawkIntech/Files to create a folder HawkIntech with a subfolder Files and save the image within this folder
            mimeType: 'image/jpg', // MIME type of the file
          },
          'Image', // Media Collection to store the file in ("Audio" | "Image" | "Video" | "Download")
          res.path(), // Path to the file being copied in the apps own storage
        )
        console.log('Image downloaded successfully.')
        return result
      })
      .catch(err => {
        console.log("Couldn't download image: " + err)
      })
    image.syncStatus = 'synced'
    // change url to local url
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
