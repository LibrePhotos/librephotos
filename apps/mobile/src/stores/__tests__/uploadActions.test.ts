/**
 * Regression test for the mobile batch upload swallowing errors.
 *
 * uploadImages() wrapped the WHOLE `for (const file of files)` loop in a single
 * try/catch that only did `console.log('Error uploading images')`. So the first
 * photo the server rejected -- most commonly the HTTP 400 raised by
 * api/views/upload.py UploadPhotosChunkedComplete.on_completion() when the
 * user's scan directory is unset or does not exist -- broke out of the loop:
 *
 *   - every photo after it was silently abandoned, and
 *   - the photo that failed kept syncStatus 'local', indistinguishable from a
 *     photo that had never been attempted, so the user got no feedback at all.
 *
 * SyncStatus.SYNCING was also declared but never assigned to anything, which
 * made the "Syncing" counter in Containers/Settings/Index.js a permanent 0.
 */

const FAILING_FILE_ID = 'hash-two1'
const FILE_SIZE = 400

// The id of the photo currently being uploaded. uploadImages() asks
// `/exists/<id>/` before touching a file, so this stays in step with the loop.
let currentFileId = ''

const mockStat = jest.fn(async (path: string) => ({
  filename: String(path).split('/').pop(),
  size: FILE_SIZE,
}))

const mockBlobBuild = jest.fn(async (url: string) => ({
  size: FILE_SIZE,
  slice: (start: number, end: number) => ({
    onCreated: (cb: (blob: unknown) => void) =>
      cb({ _ref: `${url}#${start}-${end}` }),
  }),
}))

// Sync status seen by the server while a photo's chunk is in flight.
const statusDuringUpload: Record<string, string | undefined> = {}

// Ids the server already has, so uploadImages() takes its short-circuit branch.
const alreadyUploaded = new Set<string>()

const mockGet = jest.fn(async (endpoint: string) => {
  currentFileId = endpoint.split('/')[2]
  return { exists: alreadyUploaded.has(currentFileId) }
})

const mockRequest = jest.fn(async () => {
  statusDuringUpload[currentFileId] = useLocalImagesStore
    .getState()
    .images.find(image => image.id === currentFileId)?.syncStatus
  return { offset: FILE_SIZE, upload_id: 'chunked-upload-1' }
})

const mockPost = jest.fn(async () => {
  if (currentFileId === FAILING_FILE_ID) {
    throw new Error('API error: 400 Bad Request')
  }
  return {}
})

jest.mock('react-native-file-access', () => ({
  FileSystem: {
    stat: (...args: any[]) => mockStat(...(args as [string])),
  },
}))

jest.mock('react-native-blob-util', () => ({
  wrap: (url: string) => url,
  polyfill: {
    Blob: {
      build: (...args: any[]) => mockBlobBuild(...(args as [string])),
    },
  },
}))

jest.mock('../../api_client/api', () => ({
  fetchClient: {
    get: (...args: any[]) => mockGet(...(args as [string])),
    post: (...args: any[]) => mockPost(...(args as [])),
    request: (...args: any[]) => mockRequest(...(args as [])),
  },
}))

import { uploadImages } from '../uploadActions'
import { useLocalImagesStore } from '../localImagesStore'
import { useUploadStore } from '../uploadStore'
import { MediaType, SyncStatus } from '../types/localImages.zod'

const localImage = (id: string, name: string) => ({
  id,
  url: `/storage/emulated/0/DCIM/Camera/${name}.jpg`,
  aspectRatio: 1.33,
  type: MediaType.IMAGE,
  syncStatus: SyncStatus.LOCAL,
  rating: 0,
  isTemp: false,
})

const files = [
  localImage('hash-one1', 'one'),
  localImage(FAILING_FILE_ID, 'two'),
  localImage('hash-three1', 'three'),
]

const statusOf = (id: string) =>
  useLocalImagesStore.getState().images.find(image => image.id === id)
    ?.syncStatus

describe('uploadImages', () => {
  beforeEach(() => {
    currentFileId = ''
    alreadyUploaded.clear()
    Object.keys(statusDuringUpload).forEach(key => {
      delete statusDuringUpload[key]
    })
    mockGet.mockClear()
    mockPost.mockClear()
    mockRequest.mockClear()
    useLocalImagesStore.setState({
      images: files.map(file => ({ ...file })),
      lastFetch: undefined,
      isLoading: false,
    })
    useUploadStore.getState().reset()
  })

  it('keeps uploading the rest of the batch after one photo is rejected', async () => {
    await uploadImages(files)

    // One /upload/complete/ per photo -- the rejected one must not end the run.
    expect(mockPost).toHaveBeenCalledTimes(3)
    expect(statusOf('hash-one1')).toBe(SyncStatus.SYNCED)
    expect(statusOf('hash-three1')).toBe(SyncStatus.SYNCED)
  })

  it('records the rejected photo as failed instead of leaving it unsynced', async () => {
    await uploadImages(files)

    expect(statusOf(FAILING_FILE_ID)).not.toBe(SyncStatus.LOCAL)
    expect(statusOf(FAILING_FILE_ID)).not.toBe(SyncStatus.SYNCED)
    expect(statusOf(FAILING_FILE_ID)).toBe(SyncStatus.FAILED)
  })

  it('marks a photo as syncing while its upload is in flight', async () => {
    await uploadImages(files)

    expect(statusDuringUpload['hash-one1']).toBe(SyncStatus.SYNCING)
    expect(statusDuringUpload[FAILING_FILE_ID]).toBe(SyncStatus.SYNCING)
    expect(statusDuringUpload['hash-three1']).toBe(SyncStatus.SYNCING)
  })

  it('leaves no photo stuck in syncing once the batch is over', async () => {
    await uploadImages(files)

    expect(
      useLocalImagesStore
        .getState()
        .images.filter(image => image.syncStatus === SyncStatus.SYNCING),
    ).toHaveLength(0)
    expect(useUploadStore.getState().isUploading).toBe(false)
  })

  // SYNCING is persisted to AsyncStorage, so every branch that sets it has to
  // reach a terminal status. The "server already has this file" short circuit
  // skips the chunk loop entirely -- it must still settle on SYNCED.
  it('settles a photo the server already has instead of leaving it syncing', async () => {
    alreadyUploaded.add('hash-one1')

    await uploadImages(files)

    expect(statusOf('hash-one1')).toBe(SyncStatus.SYNCED)
    expect(
      useLocalImagesStore
        .getState()
        .images.filter(image => image.syncStatus === SyncStatus.SYNCING),
    ).toHaveLength(0)
  })
})
