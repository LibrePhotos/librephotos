import React from 'react'
import { View } from 'react-native'
import { useAppSelector } from '../Store/store'
import Icon from 'react-native-vector-icons/Feather'
import ReactNativeBlobUtil from 'react-native-blob-util'

type DownloadButtonProps = {
  image: any
}

/**
A React component that renders a download button to download an image
and save it to the device's media store.
@param {object} props.image - The image object to be downloaded.
@returns {JSX.Element|null} Returns a JSX element containing a download button or null if the image is already downloaded.
*/
export function DownloadButton(props: DownloadButtonProps): JSX.Element | null {
  /*
  The base URL of the API used to download the image.
  @type {string}
  */
  const { baseurl } = useAppSelector(state => state.config)
  /**
  The access token of the authenticated user.
  @type {string}
  */
  const { access } = useAppSelector(state => state.auth)
  /**
  The image object passed as a prop to the component.
  @type {object}
  */
  const { image } = props
  /**
  The event handler function that downloads and saves the image to the device's media store.
  @returns {Promise<void>} Returns a promise that resolves when the image is downloaded and saved.
  */
  const onPress = async (): Promise<void> => {
    let image_url = baseurl + '/media/photos/' + image.id
    await ReactNativeBlobUtil.config({
      fileCache: true,
    })
      .fetch('GET', image_url, {
        Authorization: 'Bearer ' + access.token,
      })
      .then(async res => {
        let result = await ReactNativeBlobUtil.MediaCollection.copyToMediaStore(
          {
            name: image.id + '.jpg', // name of the file
            parentFolder: '', // subdirectory in the Media Store
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
    // To-Do: change url to local url
  }

  /**
  Renders a download button if the image is not downloaded yet, or null if the image is already downloaded.
  @returns {JSX.Element|null} Returns a JSX element containing a download button or null if the image is already downloaded.
  */
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
