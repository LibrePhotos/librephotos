import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import { UploadState } from './upload.zod'
import { RootState } from '../store'
import type { Dispatch } from 'redux'

import { api } from '../api'
import { FileSystem } from 'react-native-file-access'
import ReactNativeBlobUtil from 'react-native-blob-util'
import Server from '../../Services'
import CookieManager from '@react-native-cookies/cookies'
import { localImageSynced } from '../LocalImages/LocalImagesSlice'
const initialState: UploadState = {
  total: 1,
  current: 1,
  isUploading: false,
}

export function scanUploadedPhotos() {
  return function (dispatch: Dispatch<any>) {
    dispatch({ type: 'SCAN_PHOTOS' })
    dispatch({ type: 'SET_WORKER_AVAILABILITY', payload: false })

    Server.get('scanuploadedphotos/')
      .then(response => {
        dispatch({ type: 'SCAN_PHOTOS_FULFILLED', payload: response.data })
      })
      .catch(err => {
        dispatch({ type: 'SCAN_PHOTOS_REJECTED', payload: err })
      })
  }
}

const uploadSlice = createSlice({
  name: 'uploadSlice',
  initialState: initialState,
  reducers: {
    setCurrentSize: (state, action) => {
      return {
        ...state,
        current: action.payload,
      }
    },
    setTotalSize: (state, action) => {
      return {
        ...state,
        total: action.payload,
      }
    },

    reset: () => {
      console.log('Resetting upload')
      return initialState
    },
  },
  extraReducers: builder => {
    builder.addCase(uploadImages.pending, state => {
      return {
        ...state,
        isUploading: true,
      }
    })
    builder.addCase(uploadImages.fulfilled, state => {
      return {
        ...state,
        isUploading: false,
      }
    })
    builder.addCase(uploadImages.rejected, (state, action) => {
      console.log('Error uploading images')
      console.log(action)
      return {
        ...state,
        isUploading: false,
      }
    })
  },
})

const chunkSize = 1000000 // < 1MB chunks, because of default of nginx

let currentUploadedFileSize = 0

const uploadExists = async (hash: string, dispatch: any) =>
  dispatch(api.endpoints.uploadExists.initiate(hash))

const uploadFinished = async (
  fileName: string,
  md5: string,
  uploadId: string,
  user_id: number,
  dispatch: any,
) => {
  const formData = new FormData()
  formData.append('upload_id', uploadId)
  formData.append('md5', md5)
  formData.append('user', user_id.toString())
  formData.append('filename', fileName)
  dispatch(api.endpoints.uploadFinished.initiate(formData))
}

const uploadChunk = async (
  chunk: any,
  uploadId: string,
  offset: number,
  baseurl: string,
  user_id: number,
) => {
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

  // FIX-ME: This is empty
  formData.append('md5', '')
  formData.append('offset', offset.toString())
  formData.append('user', user_id.toString())
  const result = await Server.post('upload/', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      'X-CSRFToken': cookies.csrftoken.value,
    },
    transformRequest: data => {
      return data
    },
  }).then(response => response)
  return result
}

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
          )
          if ('data' in response) {
            offset = response.data.offset
            uploadId = response.data.upload_id
          }
          // To-Do: Handle Error
          if (chunks[offset / chunkSize]) {
            currentUploadedFileSize += chunks[offset / chunkSize].size
          } else {
            currentUploadedFileSize +=
              file.size -
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
        currentUploadedFileSize += file.size
        dispatch(setCurrentSize(currentUploadedFileSize))
        dispatch(localImageSynced(file))
      }
    }
    // To-Do: dispatch an update for the image, that it is now uploaded
    dispatch(scanUploadedPhotos())
  },
)

export const { actions: uploadActions, reducer: uploadReducer } = uploadSlice
export const { setCurrentSize, setTotalSize, reset } = uploadActions
