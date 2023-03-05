import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import {
  LocalImage,
  LocalImages,
  LocalImagesState,
  MediaType,
  SyncStatus,
} from './LocalImages.zod'
import moment from 'moment'
import { FileSystem } from 'react-native-file-access'
import { RootState, store } from '../../Store/store'
import { PermissionsAndroid, Platform } from 'react-native'
import {
  CameraRoll,
  PhotoIdentifier,
} from '@react-native-camera-roll/camera-roll'

const initialState: LocalImagesState = {
  images: [] as LocalImages,
  lastFetch: undefined,
  isLoading: false,
}

export const camerarollPhotoMapper = async (item: PhotoIdentifier) => {
  const photo: LocalImage = {
    id: await FileSystem.hash(item.node.image.uri, 'MD5').then(hash => {
      return hash + store.getState().auth.access?.user_id
    }),
    aspectRatio: item.node.image.width / item.node.image.height,
    isTemp: false,
    type: MediaType.IMAGE,
    syncStatus: SyncStatus.LOCAL,
    url: item.node.image.uri,
    date: moment.unix(item.node.timestamp).unix().toString(),
    birthTime: moment.unix(item.node.timestamp).format('YYYY-MM-DD'),
    location: '',
    rating: 0,
  }
  return photo
}

type PageInfo = {
  has_next_page: boolean
  start_cursor?: string | undefined
  end_cursor?: string | undefined
}

export const loadLocalImages = createAsyncThunk(
  'localImages/loadLocalImages',
  async () => {
    if (Platform.OS === 'android' && !(await hasAndroidPermission())) {
      return
    }
    const lastFetch = (store.getState() as RootState).localImages.lastFetch
    var photos = [] as LocalImages
    var page_info: PageInfo = {
      has_next_page: true,
      start_cursor: undefined,
      end_cursor: undefined,
    }
    // load images from CameraRoll
    // To-Do: Check on phone
    while (page_info.has_next_page) {
      page_info = await CameraRoll.getPhotos({
        first: 100,
        after: page_info.end_cursor,
        assetType: 'Photos',
      }).then(async r => {
        const currentPage = await Promise.all(
          r.edges.map(item => {
            return camerarollPhotoMapper(item)
          }),
        ).catch(err => {
          console.log(err)
        })
        photos = [...photos, ...currentPage]
        return r.page_info
      })
    }
    return photos
  },
)

const localImagesSlice = createSlice({
  name: 'localImages',
  initialState: initialState,
  reducers: {
    syncImages: (state, { payload }) => {
      // To-Do: Update the syncStatus of the images to synced
      // based on the payload
      return {
        ...state,
      }
    },
  },
  extraReducers: builder => {
    builder.addCase(loadLocalImages.pending, state => {
      return {
        ...state,
        isLoading: true,
      }
    })
    builder.addCase(loadLocalImages.fulfilled, (state, { payload }) => {
      // To-Do: Only load new data :)
      return {
        ...state,
        images: payload,
        lastFetch: moment().unix(),
        isLoading: false,
      }
    })
    builder.addCase(loadLocalImages.rejected, state => {
      return {
        ...state,
        isLoading: false,
      }
    })
  },
})

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

export const { actions: localImagesActions, reducer: localImagesReducer } =
  localImagesSlice
export const { loadNewImages, syncImages } = localImagesActions
