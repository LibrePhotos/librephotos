/**
 * Regression test for LibrePhotos issue #788 -- "No local photos".
 *
 * https://github.com/LibrePhotos/librephotos/issues/788
 *
 * Symptom (Android 11/12/13): storage / "photos and videos" permission is
 * granted, server photos render fine, but the timeline never shows a single
 * on-device photo.
 *
 * loadLocalImages() maps every camera roll edge through camerarollPhotoMapper(),
 * which calls `FileSystem.hash(uri, 'MD5')` to build the photo id. That mapping
 * used to be wrapped in a single all-or-nothing `Promise.all(...)`: as soon as
 * ONE asset could not be hashed (broken file, or a MediaStore `content://` uri
 * that react-native-file-access cannot open under scoped storage) the whole
 * page collapsed to `undefined`, `no_valid_photos` flipped to true, the paging
 * loop exited and nothing was stored. A single bad asset silently wiped out
 * every other local photo -- exactly the reported "no local photos, no error".
 */

// Three assets on the device. The middle one cannot be hashed (scoped-storage
// content:// uri / unreadable file); the other two are perfectly fine.
const mockUnreadableUri = 'content://media/external/images/media/2'

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 33 },
  PermissionsAndroid: {
    PERMISSIONS: {
      READ_MEDIA_IMAGES: 'android.permission.READ_MEDIA_IMAGES',
      READ_EXTERNAL_STORAGE: 'android.permission.READ_EXTERNAL_STORAGE',
    },
    // permission granted -- the reporters all confirmed they granted it
    check: jest.fn().mockResolvedValue(true),
    request: jest.fn().mockResolvedValue('granted'),
  },
}))

jest.mock('react-native-file-access', () => ({
  FileSystem: {
    hash: jest.fn(async (uri: string) => {
      if (uri === mockUnreadableUri) {
        throw new Error('ENOENT: could not open file for hashing')
      }
      return `hash-of-${uri}`
    }),
  },
}))

const mockGetPhotos = jest.fn()

jest.mock('@react-native-camera-roll/camera-roll', () => ({
  CameraRoll: {
    getPhotos: (...args: unknown[]) => mockGetPhotos(...args),
    deletePhotos: jest.fn(),
  },
}))

// Keep the network / upload side of the store out of this test.
jest.mock('../api_client/api', () => ({
  fetchClient: { get: jest.fn().mockResolvedValue({ exists: false }) },
}))

jest.mock('./uploadActions', () => ({
  uploadImages: jest.fn().mockResolvedValue(undefined),
}))

import { loadLocalImages } from './localImagesActions'
import { useLocalImagesStore } from './localImagesStore'

const edge = (id: string, uri: string) => ({
  node: {
    id,
    type: 'image/jpeg',
    timestamp: 1678000000,
    image: { uri, width: 4000, height: 3000, filename: `${id}.jpg` },
  },
})

describe('loadLocalImages', () => {
  beforeEach(() => {
    useLocalImagesStore.setState({
      images: [],
      lastFetch: undefined,
      isLoading: false,
    })
    mockGetPhotos.mockReset()
    mockGetPhotos.mockResolvedValue({
      edges: [
        edge('1', 'file:///storage/emulated/0/DCIM/Camera/one.jpg'),
        edge('2', mockUnreadableUri),
        edge('3', 'file:///storage/emulated/0/DCIM/Camera/three.jpg'),
      ],
      page_info: { has_next_page: false, start_cursor: '0', end_cursor: '2' },
    })
  })

  it('keeps the readable device photos when a single asset cannot be hashed', async () => {
    await loadLocalImages()

    const { images } = useLocalImagesStore.getState()
    const urls = images.map(image => image.url)

    // One unreadable asset must not swallow the whole camera roll.
    expect(urls).toEqual([
      'file:///storage/emulated/0/DCIM/Camera/one.jpg',
      'file:///storage/emulated/0/DCIM/Camera/three.jpg',
    ])
  })

  it('loads every device photo when all assets are hashable', async () => {
    mockGetPhotos.mockResolvedValue({
      edges: [
        edge('1', 'file:///storage/emulated/0/DCIM/Camera/one.jpg'),
        edge('2', 'file:///storage/emulated/0/DCIM/Camera/two.jpg'),
        edge('3', 'file:///storage/emulated/0/DCIM/Camera/three.jpg'),
      ],
      page_info: { has_next_page: false, start_cursor: '0', end_cursor: '2' },
    })

    await loadLocalImages()

    expect(useLocalImagesStore.getState().images).toHaveLength(3)
  })
})
