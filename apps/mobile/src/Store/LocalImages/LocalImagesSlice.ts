import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import {
  LocalImage,
  LocalImages,
  LocalImagesState,
  MediaType,
  SyncStatus,
} from './LocalImages.zod'
import { uploadImages } from '../Upload/UploadSlice'
import moment from 'moment'
import { FileSystem } from 'react-native-file-access'
import { RootState, store } from '../../Store/store'
import { PermissionsAndroid, Platform } from 'react-native'
import {
  CameraRoll,
  PhotoIdentifier,
} from '@react-native-camera-roll/camera-roll'
import { api } from '../api'

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

export const checkIfLocalImagesAreSynced = createAsyncThunk(
  'localImages/checkIfLocalImagesAreSynced',
  async (_, apiThunk) => {
    const dispatch = apiThunk.dispatch
    const localImages = (store.getState() as RootState).localImages.images

    localImages
      .filter(image => image.syncStatus !== SyncStatus.SYNCED)
      .map(async image => {
        const result = await dispatch(
          api.endpoints.uploadExists.initiate(image.id),
        )
        if (result.data) {
          dispatch(localImageSynced(image))
        }
      })
  },
)

export const loadLocalImages = createAsyncThunk(
  'localImages/loadLocalImages',
  async () => {
    if (Platform.OS === 'android' && !(await hasReadAndroidPermission())) {
      return
    }
    const lastFetch = (store.getState() as RootState).localImages.lastFetch
    var photos = [] as LocalImages
    var page_info: PageInfo = {
      has_next_page: true,
      start_cursor: undefined,
      end_cursor: undefined,
    }
    console.log('Loading local images')
    console.log(
      'Last fetch: ',
      lastFetch ? moment.unix(lastFetch).format('YYYY-MM-DD') : 'Never',
    )
    // load images from CameraRoll
    // To-Do: Check on phone
    while (page_info.has_next_page) {
      page_info = await CameraRoll.getPhotos({
        first: 100,
        after: page_info.end_cursor,
        // only load images that are newer than the last fetch
        // To-Do. This broken somehow
        // fromTime: lastFetch,
        // toTime: moment().unix(),
        assetType: 'Photos',
      }).then(async r => {
        const currentPage = await Promise.all(
          r.edges.map(item => {
            // To-Do: This shoud work, but it should be done with getPhotos tbh...
            if (!lastFetch || item.node.timestamp > lastFetch) {
              return camerarollPhotoMapper(item)
            }
          }),
        ).catch(err => {
          console.log(err)
        })
        //filter all undefined values
        const newPhotos = currentPage.filter(item => item !== undefined)
        console.log('Number of new items: ', newPhotos.length)
        photos = [...photos, ...newPhotos]
        return r.page_info
      })
    }

    return photos
  },
)

export const removeBackedUpImages = createAsyncThunk(
  'localImages/removeBackedUpImages',
  async (_, apiThunk) => {
    //To-Do: Ask for manage files permission somehow, maybe ask them by hand or something
    //if (Platform.OS === 'android' && !(await hasWriteAndroidPermission())) {
    //  return
    //}
    const dispatch = apiThunk.dispatch
    const localImages = (store.getState() as RootState).localImages.images
    const deletedImages = [] as LocalImage[]
    for (const image of localImages) {
      console.log('Checking if image is synced: ' + image.id)
      console.log('Sync status: ' + image.syncStatus)
      if (image.syncStatus === SyncStatus.SYNCED) {
        const result = await dispatch(
          api.endpoints.uploadExists.initiate(image.id),
        )
        if (result.data) {
          deletedImages.push(image)
        }
      }
    }
    if (deletedImages.length > 0) {
      CameraRoll.deletePhotos(deletedImages.map(image => image.url))
    }
    return deletedImages
  },
)

export const syncAllLocalImages = createAsyncThunk(
  'localImages/syncAllLocalImages',
  async (_, apiThunk) => {
    const dispatch = apiThunk.dispatch
    await dispatch(checkIfLocalImagesAreSynced())
    const localImages = (store.getState() as RootState).localImages.images
    const nonSyncedImages = localImages.filter(
      image => image.syncStatus !== SyncStatus.SYNCED,
    )
    if (nonSyncedImages.length > 0) {
      await dispatch(uploadImages(nonSyncedImages))
    }
  },
)

const localImagesSlice = createSlice({
  name: 'localImages',
  initialState: initialState,
  reducers: {
    localImageSynced: (state, { payload }) => {
      console.log('Local image synced: ' + payload.id)
      return {
        ...state,
        images: state.images.map(image =>
          image.id === payload.id
            ? { ...image, syncStatus: SyncStatus.SYNCED }
            : image,
        ),
      }
    },
    reset: () => {
      console.log('Resetting local images')
      return initialState
    },
  },
  extraReducers: builder => {
    builder.addCase(removeBackedUpImages.fulfilled, (state, { payload }) => {
      console.log('Removing backed up images: ' + payload.length)
      return {
        ...state,
        images: state.images.filter(
          image => !payload.some(deletedImage => deletedImage.id === image.id),
        ),
      }
    })
    builder.addCase(loadLocalImages.pending, state => {
      return {
        ...state,
        isLoading: true,
      }
    })
    builder.addCase(loadLocalImages.fulfilled, (state, { payload }) => {
      return {
        ...state,
        // To-Do: Add this again when lastFetch works correctly
        images: [...state.images, ...payload],
        lastFetch: payload.length > 0 ? moment().unix() : state.lastFetch,
        isLoading: false,
      }
    })
    builder.addCase(loadLocalImages.rejected, state => {
      console.log(state.images)
      console.log('Error loading local images')
      return {
        ...state,
        isLoading: false,
      }
    })
  },
})

async function hasReadAndroidPermission() {
  const permission =
    (Platform.Version as number) >= 33
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
export const { localImageSynced, reset } = localImagesActions
