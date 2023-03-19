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

/**
 * LocalImagesState represents the initial state of the local images reducer.
 * @property {LocalImages} images - An array of LocalImages.
 * @property {Date | undefined} lastFetch - Date when the images were last fetched, or undefined if they have not been fetched yet.
 * @property {boolean} isLoading - Indicates whether the images are being fetched or not.
 */
const initialState: LocalImagesState = {
  images: [] as LocalImages,
  lastFetch: undefined,
  isLoading: false,
}

/**
 * camerarollPhotoMapper is an asynchronous function that maps a PhotoIdentifier to a LocalImage object.
 * @param {PhotoIdentifier} item - The PhotoIdentifier object to be mapped.
 * @returns {Promise<LocalImage>} A promise that resolves to a LocalImage object.
 */
export const camerarollPhotoMapper = async (
  item: PhotoIdentifier,
): Promise<LocalImage> => {
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

/**
 * PageInfo represents the pagination information returned by an API.
 * @property {boolean} has_next_page - Indicates whether there are more pages to fetch.
 * @property {string | undefined} start_cursor - The cursor to start fetching from.
 * @property {string | undefined} end_cursor - The cursor to end fetching at.
 */
type PageInfo = {
  has_next_page: boolean
  start_cursor?: string | undefined
  end_cursor?: string | undefined
}

/**
 * checkIfLocalImagesAreSynced is an asynchronous thunk that checks if the local images have been synced with the remote server.
 * @param {undefined} _ - This parameter is unused.
 * @param {AsyncThunkApi<unknown, undefined, {}>} apiThunk - The `AsyncThunkApi` object provided by the Redux Toolkit.
 * @returns {Promise<void>} A promise that resolves when the sync status of all local images has been checked.
 */
export const checkIfLocalImagesAreSynced = createAsyncThunk(
  'localImages/checkIfLocalImagesAreSynced',
  async (_, apiThunk: AsyncThunkApi<unknown, undefined, {}>) => {
    const dispatch = apiThunk.dispatch
    const localImages = (store.getState() as RootState).localImages.images

    localImages.map(async image => {
      const result = await dispatch(
        api.endpoints.uploadExists.initiate(image.id),
      )
      // To-Do: Check this more efficiently
      if (result.data) {
        dispatch(localImageSynced(image))
      } else {
        dispatch(localImageNotSynced(image))
      }
    })
  },
)

/**
 * PageInfoWithNoValidPhotos represents the pagination information returned by an API along with a flag indicating if there are no valid photos on the page.
 * @property {boolean} has_next_page - Indicates whether there are more pages to fetch.
 * @property {string | undefined} start_cursor - The cursor to start fetching from.
 * @property {string | undefined} end_cursor - The cursor to end fetching at.
 * @property {boolean} no_valid_photos - Indicates whether there are no valid photos on the page.
 */
type PageInfoWithNoValidPhotos = PageInfo & {
  no_valid_photos: boolean
}

/**
 * Async function to load all local images
 * @return Promise<LocalImage[]> An array of local images
 */
export const loadLocalImages = createAsyncThunk(
  'localImages/loadLocalImages',
  async () => {
    if (Platform.OS === 'android' && !(await hasReadAndroidPermission())) {
      return
    }
    const lastFetch = (store.getState() as RootState).localImages.lastFetch
    var photos = [] as LocalImages
    var page_info: PageInfoWithNoValidPhotos = {
      has_next_page: true,
      start_cursor: undefined,
      end_cursor: undefined,
      no_valid_photos: false,
    }
    console.log('Loading local images')
    console.log(
      'Last fetch: ',
      lastFetch ? moment.unix(lastFetch).format('YYYY-MM-DD') : 'Never',
    )
    // load images from CameraRoll
    while (page_info.has_next_page && !page_info.no_valid_photos) {
      page_info = await CameraRoll.getPhotos({
        first: 100,
        after: page_info.end_cursor,
        // only load images that are newer than the last fetch
        // To-Do: This broken somehow
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
        return { ...r.page_info, no_valid_photos: newPhotos.length === 0 }
      })
    }

    return photos
  },
)

/**
 * Async function to remove all backed-up local images
 * @return Promise<LocalImage[]> An array of deleted local images
 */
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

/**
 * Async function to sync all local images that are not yet synced
 * @return Promise<void>
 */
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

/**
 * A slice of the Redux store representing local images.
 * @typedef {Object} LocalImagesSlice
 * @property {string} name - The name of the slice.
 * @property {Object} initialState - The initial state of the slice.
 * @property {Array} initialState.images - The list of local images.
 * @property {boolean} initialState.isLoading - Indicates if images are being loaded.
 * @property {number} initialState.lastFetch - The timestamp of the last fetch.
 * @property {Object} reducers - The reducer functions for the slice.
 * @property {Function} reducers.localImageSynced - Updates the sync status of a local image to SYNCED.
 * @property {Function} reducers.localImageNotSynced - Updates the sync status of a local image to LOCAL.
 * @property {Function} reducers.reset - Resets the local images state to its initial state.
 * @property {Object} extraReducers - Additional reducer functions not explicitly tied to this slice.
 * @property {Function} extraReducers.builder.addCase - Adds a case to the reducer.
 * @property {Function} extraReducers.builder.addCase(removeBackedUpImages.fulfilled) - Removes backed up images from the local images list.
 * @property {Function} extraReducers.builder.addCase(loadLocalImages.pending) - Indicates that local images are being loaded.
 * @property {Function} extraReducers.builder.addCase(loadLocalImages.fulfilled) - Adds loaded local images to the local images list.
 * @property {Function} extraReducers.builder.addCase(loadLocalImages.rejected) - Logs an error when local images fail to load.
 */
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
    localImageNotSynced: (state, { payload }) => {
      console.log('Local image not synced: ' + payload.id)
      // only update if changed
      if (
        state.images.find(image => image.id === payload.id)?.syncStatus ===
        SyncStatus.LOCAL
      ) {
        return state
      }

      return {
        ...state,
        images: state.images.map(image =>
          image.id === payload.id
            ? { ...image, syncStatus: SyncStatus.LOCAL }
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
    builder.addCase(loadLocalImages.rejected, (state, action) => {
      console.log('Error loading local images: ' + action.error.message)
      console.log(JSON.stringify(action))
      return {
        ...state,
        isLoading: false,
      }
    })
  },
})

/**
 * Checks if the app has permission to read media images from the user's device.
 * If the permission is not granted, requests permission and returns true if granted.
 * @returns A Promise that resolves to a boolean indicating whether the permission is granted.
 */
async function hasReadAndroidPermission(): Promise<boolean> {
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

/**
 * Contains actions and reducer for managing local images.
 */
export const { actions: localImagesActions, reducer: localImagesReducer } =
  localImagesSlice

/**
 * A set of action creators for the local images slice.
 */
export const { localImageSynced, localImageNotSynced, reset } =
  localImagesActions
