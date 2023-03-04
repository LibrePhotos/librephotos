import { imageGridReducer } from './ImageGridReducer'
import { PermissionsAndroid, Platform } from 'react-native'
import { CameraRoll } from '@react-native-camera-roll/camera-roll'
import moment from 'moment'
import { FileSystem } from 'react-native-file-access'
import { store } from '../../Store/store'

//To-Do: Add a popup to ask for permission
async function hasAndroidPermission() {
  const permission =
    Platform.Version >= 33
      ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
      : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE

  const hasPermission = await PermissionsAndroid.check(permission)
  if (hasPermission) {
    return true
  }

  const status = await PermissionsAndroid.request(permission)
  return status === 'granted'
}

export function addTempElementsToGroups(photosGroupedByDate) {
  photosGroupedByDate.forEach(group => {
    for (var i = 0; i < group.numberOfItems; i++) {
      group.items.push({
        id: i.toString(),
        aspectRatio: 1,
        isTemp: true,
      })
    }
  })
}

export const camerarollPhotoMapper = async item => {
  return {
    id: await FileSystem.hash(item.node.image.uri, 'MD5').then(hash => {
      return hash + store.getState().auth.access.user_id
    }),
    aspectRatio: item.node.image.width / item.node.image.height,
    isTemp: false,
    type: 'cameraroll',
    url: item.node.image.uri,
    video_length: '',
    date: moment.unix(item.node.timestamp).unix(),
    birth_date: moment.unix(item.node.timestamp).format('YYYY-MM-DD'),
    location: '',
  }
}

export const photoMapper = async photosResult => {
  if (Platform.OS === 'android' && !(await hasAndroidPermission())) {
    return
  }
  if (typeof photosResult === 'undefined' || photosResult.length < 1) {
    return []
  }
  addTempElementsToGroups(photosResult)
  var finalmap = photosResult.map(item => {
    return {
      id: item.id,
      title: item.date,
      data: imageGridReducer(item.items),
      incomplete: item.incomplete,
      numberOfItems: item.numberOfItems,
    }
  })

  // load images from CameraRoll
  // TODO: Figure out how to load all images from CameraRoll
  const mergedPhotos = CameraRoll.getPhotos({
    first: 100,
    assetType: 'Photos',
  })
    .then(async r => {
      const photos = await Promise.all(
        r.edges.map(item => {
          return camerarollPhotoMapper(item)
        }),
      )
      photos.forEach(photo => {
        let date = photo.birth_date
        // check if date exists within finalmap
        let index = finalmap.findIndex(x => x.title === date)
        if (index === -1) {
          const newAlbumDate = {
            id: date,
            title: date,
            data: photo,
            incomplete: false,
            numberOfItems: 1,
          }
          finalmap = [...finalmap, newAlbumDate]

          finalmap.sort((a, b) => {
            return new Date(b.title) - new Date(a.title)
          })
        }
        // add to existing date
        // Todo: Check if file already exists by comparing id
        else {
          var changedAlbumDate = finalmap[index]
          changedAlbumDate.data = [...changedAlbumDate.data, photo]
          changedAlbumDate.numberOfItems += 1
        }
      })
      return finalmap
    })
    .catch(err => {
      console.log(err)
    })

  return mergedPhotos
}
