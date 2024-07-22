import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { UploadState } from './upload.zod'
import { RootState } from '../store'

import { api } from '../api'
import { FileSystem } from 'react-native-file-access'
import ReactNativeBlobUtil from 'react-native-blob-util'
import Server from '../../Services'
import CookieManager from '@react-native-cookies/cookies'
import { localImageSynced } from '../LocalImages/LocalImagesSlice'

/**
 * The initial state of the upload slice
 */
const initialState: UploadState = {
  total: 1,
  current: 1,
  isUploading: false,
}

/**
 * The upload slice, containing reducers and extra reducers
 */
const uploadSlice = createSlice({
  name: 'uploadSlice',
  initialState: initialState,
  reducers: {
    /**
     * Sets the current size of the upload state
     * @param state - The current state of the upload slice
     * @param action - The action object containing the new current size
     * @returns The updated state of the upload slice
     */
    setCurrentSize: (state, action) => {
      return {
        ...state,
        current: action.payload,
      }
    },
    /**
     * Sets the total size of the upload state
     * @param state - The current state of the upload slice
     * @param action - The action object containing the new total size
     * @returns The updated state of the upload slice
     */
    setTotalSize: (state, action) => {
      return {
        ...state,
        total: action.payload,
      }
    },
    /**
     * Resets the upload slice to its initial state
     * @returns The initial state of the upload slice
     */
    reset: () => {
      console.log('Resetting upload')
      return initialState
    },
  },
  extraReducers: builder => {
    /**
     * Handles the pending state of the uploadImages promise
     * @param state - The current state of the upload slice
     * @returns The updated state of the upload slice
     */
    builder.addCase(uploadImages.pending, state => {
      return {
        ...state,
        isUploading: true,
      }
    })
    /**
     * Handles the fulfilled state of the uploadImages promise
     * @param state - The current state of the upload slice
     * @returns The updated state of the upload slice
     */
    builder.addCase(uploadImages.fulfilled, state => {
      return {
        ...state,
        isUploading: false,
      }
    })
    /**
     * Handles the rejected state of the uploadImages promise
     * @param state - The current state of the upload slice
     * @param action - The action object containing the error information
     * @returns The updated state of the upload slice
     */
    builder.addCase(uploadImages.rejected, (state, action) => {
      console.log('Error uploading images')
      console.log(JSON.stringify(action))
      return {
        ...state,
        isUploading: false,
      }
    })
  },
})

/**
 * The chunk size to use for uploading files.
 */
const chunkSize = 1000000 // < 1MB chunks, because of default of nginx

/**
 * Checks if an upload exists on the server.
 *
 * @param hash - The hash of the file to check.
 * @param dispatch - The dispatch function for API requests.
 * @returns A promise that resolves with the upload status of the file.
 */
const uploadExists = async (hash: string, dispatch: any): Promise<any> =>
  dispatch(api.endpoints.uploadExists.initiate(hash))

/**
 * Sends a request to the server to finalize an upload.
 *
 * @param fileName - The name of the file being uploaded.
 * @param md5 - The MD5 checksum of the file being uploaded.
 * @param uploadId - The ID of the upload.
 * @param user_id - The ID of the user initiating the upload.
 * @param dispatch - The dispatch function for API requests.
 */
const uploadFinished = async (
  fileName: string,
  md5: string,
  uploadId: string,
  user_id: number,
  dispatch: any,
): Promise<void> => {
  const formData = new FormData()
  formData.append('upload_id', uploadId)
  formData.append('md5', md5)
  formData.append('user', user_id.toString())
  formData.append('filename', fileName)
  dispatch(api.endpoints.uploadFinished.initiate(formData))
}

/**
 * Uploads a chunk of a file to the server.
 *
 * @param chunk - The chunk of the file to upload.
 * @param uploadId - The ID of the upload.
 * @param offset - The offset of the chunk in the file.
 * @param baseurl - The base URL for the server.
 * @param user_id - The ID of the user initiating the upload.
 * @param file_size - The size of the file being uploaded.
 * @returns A promise that resolves with the server response to the upload request.
 */
const uploadChunk = async (
  chunk: any,
  uploadId: string,
  offset: number,
  baseurl: string,
  user_id: number,
  file_size: number,
): Promise<any> => {
  // only send first chunk without upload id
  const formData = new FormData()
  if (uploadId) {
    formData.append('upload_id', uploadId)
  }
  // To-Do: cookies should be in server file
  const cookies = await CookieManager.get(baseurl)

  formData.append('file', {
    uri: 'file://' + chunk._ref,
    type: 'application/octet-stream',
    name: 'blob',
  })

  const currentChunkSize = await FileSystem.stat(chunk._ref).then(fileStat => {
    return fileStat.size
  })

  // FIX-ME: This is empty
  formData.append('md5', '')
  formData.append('offset', offset.toString())
  formData.append('user', user_id.toString())
  const result = await Server.post('upload/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      'Content-Range': `bytes ${offset}-${
        offset + currentChunkSize - 1
      }/${file_size}`,
    },
    transformRequest: data => {
      return data
    },
  }).then(response => response)
  return result
}

/**
 * Calculates the number of chunks and returns an array of file blobs
 * @param file - The file to calculate the chunks for
 * @returns An array of file blobs
 */
const calculateChunks = async (file: any) => {
  const chunks = Math.ceil(file.size / chunkSize)
  const chunk = [] as any[]
  for (let i = 0; i < chunks; i++) {
    const chunkEnd = Math.min((i + 1) * chunkSize, file.size)
    var blob = await new Promise(res => {
      file
        .slice(i * chunkSize, chunkEnd)
        // @ts-ignore
        .onCreated(blob => {
          res(blob)
        })
    }).then(blob => blob)
    chunk.push(blob)
  }
  return chunk
}

/**
 * Uploads an array of images asynchronously
 * @param files - The array of files to upload
 * @param thunkAPI - The ThunkAPI object
 * @returns The thunk function
 */
export const uploadImages = createAsyncThunk(
  'upload/uploadImages',
  async (files: any[], thunkAPI) => {
    const { setTotalSize, setCurrentSize } = uploadSlice.actions
    const { dispatch } = thunkAPI
    const fileStats = await Promise.all(
      files.map(file => FileSystem.stat(file.url)),
    )
    dispatch(
      setTotalSize(fileStats.map(file => file.size).reduce((a, b) => a + b)),
    )
    let currentUploadedFileSize = 0
    const user_id = (thunkAPI.getState() as RootState).auth.access?.user_id
    const baseurl = (thunkAPI.getState() as RootState).config.baseurl
    for (const file of files) {
      const fileStat = await FileSystem.stat(file.url)

      const Blob = ReactNativeBlobUtil.polyfill.Blob
      // This works, but the type system is broken for whatever reason
      // @ts-ignore
      const selectedFile = await Blob.build(ReactNativeBlobUtil.wrap(file.url))
      const currentUploadedFileSizeStartValue = currentUploadedFileSize
      console.log('Current File: ' + fileStat.filename)
      // Check if the upload already exists via the hash of the file
      const isAlreadyUploaded = (await uploadExists(file.id, dispatch)).data
      let offset = 0
      let uploadId = ''
      if (!isAlreadyUploaded) {
        const chunks = await calculateChunks(selectedFile)
        // To-Do: Handle Resume and Pause
        for (let i = 0; i < chunks.length; i++) {
          const response = await uploadChunk(
            chunks[offset / chunkSize],
            uploadId,
            offset,
            baseurl,
            user_id ? user_id : 0,
            fileStat.size,
          )
          if ('data' in response) {
            offset = response.data.offset
            uploadId = response.data.upload_id
          }
          // To-Do: Handle Error
          if (chunks[offset / chunkSize]) {
            const fileStat = await FileSystem.stat(
              chunks[offset / chunkSize]._ref,
            )
            currentUploadedFileSize += fileStat.size
          } else {
            const fileStat = await FileSystem.stat(file.url)
            currentUploadedFileSize +=
              fileStat.size -
              (currentUploadedFileSize - currentUploadedFileSizeStartValue)
          }
          dispatch(setCurrentSize(currentUploadedFileSize))
        }
        uploadFinished(
          fileStat.filename,
          // Should be just the md5
          file.id.slice(0, file.id.length - 1),
          uploadId,
          user_id ? user_id : 0,
          dispatch,
        )
        dispatch(localImageSynced(file))
      } else {
        console.log('File already uploaded')
        const fileStat = await FileSystem.stat(file.url)
        currentUploadedFileSize += fileStat.size
        dispatch(setCurrentSize(currentUploadedFileSize))
        dispatch(localImageSynced(file))
      }
    }
  },
)

export const { actions: uploadActions, reducer: uploadReducer } = uploadSlice
export const { setCurrentSize, setTotalSize, reset } = uploadActions
