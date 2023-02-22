import { imageGridReducer } from './ImageGridReducer'
import { PermissionsAndroid, Platform } from 'react-native'
import { CameraRoll } from '@react-native-camera-roll/camera-roll'
import moment from 'moment'

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

export const camerarollPhotoMapper = item => {
  return {
    id: item.node.image.uri,
    aspectRatio: item.node.image.width / item.node.image.height,
    isTemp: false,
    type: 'cameraroll',
    url: item.node.image.uri,
    video_length: '',
    date: moment.unix(item.node.timestamp),
    birth_date: moment.unix(item.node.timestamp),
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
    .then(r => {
      console.log('r', r)
      r.edges.forEach(item => {
        // add to a given date or add new date
        let date = moment.unix(item.node.timestamp).format('YYYY-MM-DD')
        // check if date exists within finalmap
        let index = finalmap.findIndex(x => x.title === date)
        if (index === -1) {
          const newPhoto = camerarollPhotoMapper(item)
          const newAlbumDate = {
            id: date,
            title: date,
            data: [newPhoto],
            incomplete: false,
            numberOfItems: 1,
          }
          finalmap = [...finalmap, newAlbumDate]
          finalmap.sort((a, b) => {
            return new Date(b.title) - new Date(a.title)
          })
        }
        // To-Do: Test this
        // add to existing date
        else {
          var changedAlbumDate = finalmap[index]
          changedAlbumDate.data = [...data, camerarollPhotoMapper(item)]
          changedAlbumDate.numberOfItems += 1
          finalmap = [...finalmap, changedAlbumDate]
        }
      })
      return finalmap
    })
    .catch(err => {
      console.log(err)
    })
  return mergedPhotos
}
