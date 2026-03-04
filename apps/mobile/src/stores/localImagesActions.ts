import { PermissionsAndroid, Platform } from 'react-native'
import {
  CameraRoll,
  PhotoIdentifier,
} from '@react-native-camera-roll/camera-roll'
import { FileSystem } from 'react-native-file-access'
import moment from 'moment'
import { fetchClient } from '../api_client/api'
import { useAuthStore } from './authStore'
import { useLocalImagesStore } from './localImagesStore'
import { uploadImages } from './uploadActions'
import {
  LocalImage,
  LocalImages,
  MediaType,
  SyncStatus,
} from './types/localImages.zod'

type PageInfo = {
  has_next_page: boolean
  start_cursor?: string
  end_cursor?: string
}

type PageInfoWithNoValidPhotos = PageInfo & {
  no_valid_photos: boolean
}

export const camerarollPhotoMapper = async (
  item: PhotoIdentifier,
): Promise<LocalImage> => {
  const userId = useAuthStore.getState().access?.user_id
  const hash = await FileSystem.hash(item.node.image.uri, 'MD5')
  return {
    id: hash + userId,
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
}

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

export async function loadLocalImages(): Promise<void> {
  if (Platform.OS === 'android' && !(await hasReadAndroidPermission())) {
    return
  }

  const { lastFetch, setLoading, addImages } = useLocalImagesStore.getState()
  setLoading(true)

  let photos: LocalImages = []
  let page_info: PageInfoWithNoValidPhotos = {
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

  try {
    while (page_info.has_next_page && !page_info.no_valid_photos) {
      page_info = await CameraRoll.getPhotos({
        first: 1000,
        after: page_info.end_cursor,
        assetType: 'Photos',
      }).then(async r => {
        const currentPage = await Promise.all(
          r.edges.map(item => {
            if (!lastFetch || item.node.timestamp > lastFetch) {
              return camerarollPhotoMapper(item)
            }
          }),
        ).catch(err => {
          console.log(err)
        })
        const newPhotos = (currentPage || []).filter(
          (item): item is LocalImage => item !== undefined,
        )
        console.log('Number of new items: ', newPhotos.length)
        photos = [...photos, ...newPhotos]
        return { ...r.page_info, no_valid_photos: newPhotos.length === 0 }
      })
    }
    addImages(photos)
  } catch (err) {
    console.log('Error loading local images: ' + err)
    setLoading(false)
  }
}

export async function checkIfLocalImagesAreSynced(): Promise<void> {
  const { images, markSynced, markNotSynced } =
    useLocalImagesStore.getState()

  await Promise.all(
    images.map(async image => {
      try {
        const result = await fetchClient.get<{ exists: boolean }>(
          `/exists/${image.id}/`,
        )
        if (result.exists) {
          markSynced(image)
        } else {
          markNotSynced(image)
        }
      } catch {
        markNotSynced(image)
      }
    }),
  )
}

export async function syncAllLocalImages(): Promise<void> {
  await checkIfLocalImagesAreSynced()
  const { images } = useLocalImagesStore.getState()
  const nonSyncedImages = images.filter(
    image => image.syncStatus !== SyncStatus.SYNCED,
  )
  if (nonSyncedImages.length > 0) {
    await uploadImages(nonSyncedImages)
  }
}

export async function removeBackedUpImages(): Promise<void> {
  const { images, removeImages } = useLocalImagesStore.getState()
  const deletedImages: LocalImage[] = []

  for (const image of images) {
    console.log('Checking if image is synced: ' + image.id)
    console.log('Sync status: ' + image.syncStatus)
    if (image.syncStatus === SyncStatus.SYNCED) {
      try {
        const result = await fetchClient.get<{ exists: boolean }>(
          `/exists/${image.id}/`,
        )
        if (result.exists) {
          deletedImages.push(image)
        }
      } catch {
        // skip
      }
    }
  }

  if (deletedImages.length > 0) {
    CameraRoll.deletePhotos(deletedImages.map(image => image.url!))
    removeImages(deletedImages)
  }
}
