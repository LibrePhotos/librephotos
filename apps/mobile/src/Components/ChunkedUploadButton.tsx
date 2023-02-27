import CryptoJS from 'crypto-js'
import MD5 from 'crypto-js/md5'
import React, { useEffect, useState } from 'react'
import { View } from 'react-native'
import { ProgressView } from '@react-native-community/progress-view'
import scanUploadedPhotos from '../Store/Upload/ScanUploadedPhotos'
import { api } from '../Store/api'
import { useGetSettingsQuery } from '../api_client/site-settings'
import { useAppDispatch, useAppSelector } from '../Store/store'
import Icon from 'react-native-vector-icons/Feather'

export function ChunkedUploadButton() {
  const [totalSize, setTotalSize] = useState(1)
  const [currentSize, setCurrentSize] = useState(1)
  const { userSelfDetails } = useAppSelector(state => state.user)
  const { data: settings } = useGetSettingsQuery()
  const dispatch = useAppDispatch()
  const chunkSize = 1000000 // < 1MB chunks, because of default of nginx

  let currentUploadedFileSize = 0

  // To-Do: Figure out why File type does not exist, maybe react-dropzone type
  const calculateMD5 = async (file: any) => {
    const temporaryFileReader = new FileReader()
    const fileSize = file.size
    const chunkSize = 25 * 1024 * 1024 // 25MB
    let offset = 0
    const md5 = CryptoJS.algo.MD5.create()
    return new Promise<string>((resolve, reject) => {
      temporaryFileReader.onerror = () => {
        temporaryFileReader.abort()
        reject(console.log("Can't read file"))
      }

      temporaryFileReader.onload = () => {
        if (temporaryFileReader.result) {
          // @ts-ignore
          offset += temporaryFileReader.result.length

          md5.update(
            // @ts-ignore
            CryptoJS.enc.Latin1.parse(temporaryFileReader.result),
          )
          if (offset >= fileSize) {
            resolve(md5.finalize().toString(CryptoJS.enc.Hex))
          }
          readNext()
        }
      }
      function readNext() {
        const fileSlice = file.slice(offset, offset + chunkSize)
        // To-Do: Figure out why readAsBinaryString does not exist
        temporaryFileReader.readAsArrayBuffer(fileSlice)
      }
      readNext()
    })
  }

  const uploadExists = async (hash: string) =>
    dispatch(api.endpoints.uploadExists.initiate(hash))

  const uploadFinished = async (file: any, uploadId: string) => {
    const formData = new FormData()
    formData.append('upload_id', uploadId)
    formData.append('md5', await calculateMD5(file))
    formData.append('user', userSelfDetails.id.toString())
    formData.append('filename', file.name)
    dispatch(api.endpoints.uploadFinished.initiate(formData))
  }

  const calculateMD5Blob = async (blob: Blob) => {
    const reader = new FileReader()
    reader.readAsArrayBuffer(blob)
    reader.onload = () => {
      const buffer = reader.result
      // @ts-ignore
      const md5 = MD5(buffer).toString()
      return md5
    }
    return ''
  }

  const uploadChunk = async (chunk: Blob, uploadId: string, offset: number) => {
    // only send first chunk without upload id
    const formData = new FormData()
    if (uploadId) {
      formData.append('upload_id', uploadId)
    }
    formData.append('file', chunk)
    // FIX-ME: This is empty
    formData.append('md5', await calculateMD5Blob(chunk))
    formData.append('offset', offset.toString())
    formData.append('user', userSelfDetails.id.toString())
    return dispatch(
      api.endpoints.upload.initiate({
        form_data: formData,
        offset: offset,
        chunk_size: chunk.size,
      }),
    )
  }

  const calculateChunks = (file: any, chunkSize: number) => {
    const chunks = Math.ceil(file.size / chunkSize)
    const chunk = [] as Blob[]
    for (let i = 0; i < chunks; i++) {
      const chunkEnd = Math.min((i + 1) * chunkSize, file.size)
      chunk.push(file.slice(i * chunkSize, chunkEnd))
    }
    return chunk
  }

  const onDrop = async (acceptedFiles: any[]) => {
    let totalSize = 0
    acceptedFiles.forEach(file => {
      const fileSize = file.size
      totalSize += fileSize
    })
    setTotalSize(totalSize)
    for (const file of acceptedFiles) {
      const currentUploadedFileSizeStartValue = currentUploadedFileSize
      // Check if the upload already exists via the hash of the file
      const hash = (await calculateMD5(file)) + userSelfDetails.id
      const isAlreadyUploaded = (await uploadExists(hash)).data
      let offset = 0
      let uploadId = ''
      if (!isAlreadyUploaded) {
        const chunks = calculateChunks(file, chunkSize)
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
        uploadFinished(file, uploadId)
      } else {
        currentUploadedFileSize += file.size
        setCurrentSize(currentUploadedFileSize)
      }
    }
    dispatch(scanUploadedPhotos())
  }

  useEffect(() => {}, [totalSize])

  useEffect(() => {}, [currentSize])

  if (settings?.allow_upload) {
    return (
      <View style={{ width: '50px' }}>
        {currentSize / totalSize > 0.99 && (
          <Icon.Button name={'upload'} size={20} onPress={onDrop} />
        )}
        {
          //To-Do: Implement loading indicator
        }
        {currentSize / totalSize < 1 && (
          <ProgressView
            progress={(currentSize / totalSize) * 100}
            style={{
              width: '100%',
              margin: '0',
              marginTop: '5px',
            }}
            progressTintColor="orange"
            trackTintColor="blue"
          />
        )}
      </View>
    )
  }
  return null
}
