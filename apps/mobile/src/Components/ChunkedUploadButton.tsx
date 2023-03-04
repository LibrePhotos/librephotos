import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { ProgressView } from '@react-native-community/progress-view'
import { api, useFetchUserSelfDetailsQuery } from '../Store/api'
import { useGetSettingsQuery } from '../Store/Settings/site-settings'
import { useAppDispatch, useAppSelector } from '../Store/store'
import Icon from 'react-native-vector-icons/Feather'
import Server from '../Services'
import type { Dispatch } from 'redux'
import { FileSystem } from 'react-native-file-access'
import ReactNativeBlobUtil from 'react-native-blob-util'
import CookieManager from '@react-native-cookies/cookies'

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

type ChunkedUploadButtonProps = {
  image: any
}

export function ChunkedUploadButton(props: ChunkedUploadButtonProps) {
  const [totalSize, setTotalSize] = useState(1)
  const [currentSize, setCurrentSize] = useState(1)

  const { data: settings } = useGetSettingsQuery()
  const { auth, config } = useAppSelector(state => state)
  const dispatch = useAppDispatch()

  const { image } = props

  const { data: userSelfDetails } = useFetchUserSelfDetailsQuery(
    // @ts-ignore
    auth.access.user_id.toString(),
  )

  const chunkSize = 1000000 // < 1MB chunks, because of default of nginx

  let currentUploadedFileSize = 0

  const uploadExists = async (hash: string) =>
    dispatch(api.endpoints.uploadExists.initiate(hash))

  const uploadFinished = async (
    fileName: string,
    md5: string,
    uploadId: string,
  ) => {
    const formData = new FormData()
    formData.append('upload_id', uploadId)
    formData.append('md5', md5)
    formData.append('user', userSelfDetails?.id.toString())
    formData.append('filename', fileName)
    dispatch(api.endpoints.uploadFinished.initiate(formData))
  }

  const uploadChunk = async (chunk: any, uploadId: string, offset: number) => {
    // only send first chunk without upload id
    const formData = new FormData()
    if (uploadId) {
      formData.append('upload_id', uploadId)
    }
    // To-Do: cookies should be in server file
    const cookies = await CookieManager.get(config.baseurl)

    formData.append('file', {
      uri: 'file://' + chunk._ref,
      type: 'application/octet-stream',
      name: 'blob',
    })

    // FIX-ME: This is empty
    formData.append('md5', '')
    formData.append('offset', offset.toString())
    formData.append('user', userSelfDetails?.id.toString())
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

  const onPress = async () => {
    // To-Do: Clean this up
    const fileMD5 = await FileSystem.hash(image.url, 'MD5')
    const fileStat = await FileSystem.stat(image.url)
    const acceptedFiles = [] as any[]

    const Blob = ReactNativeBlobUtil.polyfill.Blob
    // This works, but the type system is broken for whatever reason
    // @ts-ignore
    const selectedFile = await Blob.build(ReactNativeBlobUtil.wrap(image.url))
    acceptedFiles.push(selectedFile)
    setTotalSize(acceptedFiles.map(file => file.size).reduce((a, b) => a + b))
    for (const file of acceptedFiles) {
      const currentUploadedFileSizeStartValue = currentUploadedFileSize
      console.log('Current File: ' + fileStat.filename)
      // Check if the upload already exists via the hash of the file
      const hash = fileMD5 + userSelfDetails?.id
      const isAlreadyUploaded = (await uploadExists(hash)).data
      let offset = 0
      let uploadId = ''
      if (!isAlreadyUploaded) {
        const chunks = await calculateChunks(file)
        // To-Do: Handle Resume and Pause
        for (let i = 0; i < chunks.length; i++) {
          const response = await uploadChunk(
            chunks[offset / chunkSize],
            uploadId,
            offset,
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
          setCurrentSize(currentUploadedFileSize)
        }
        uploadFinished(fileStat.filename, fileMD5, uploadId)
      } else {
        currentUploadedFileSize += file.size
        setCurrentSize(currentUploadedFileSize)
      }
    }
    // To-Do: dispatch an update for the image, that it is now uploaded
    dispatch(scanUploadedPhotos())
  }

  useEffect(() => {}, [totalSize])

  useEffect(() => {}, [currentSize])
  // To-Do: Only allow upload, if it is a local image only
  if (settings?.allow_upload) {
    return (
      <View>
        {currentSize / totalSize > 0.99 && (
          <Icon.Button
            backgroundColor="rgba(52, 52, 52, 0.0)"
            iconStyle={{ marginRight: 0 }}
            name={'upload'}
            size={20}
            onPress={onPress}
          />
        )}
        {currentSize / totalSize < 1 && (
          // To-Do: Check how this looks and make it pretty
          <ProgressView
            progress={(currentSize / totalSize) * 100}
            progressTintColor="orange"
            trackTintColor="blue"
          />
        )}
      </View>
    )
  } else {
    return null
  }
}
