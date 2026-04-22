import { FileSystem } from 'react-native-file-access'
import ReactNativeBlobUtil from 'react-native-blob-util'
import { fetchClient } from '../api_client/api'
import { useAuthStore } from './authStore'
import { useConfigStore } from './configStore'
import { useUploadStore } from './uploadStore'
import { useLocalImagesStore } from './localImagesStore'

const chunkSize = 1000000 // < 1MB chunks

const uploadChunk = async (
  chunk: any,
  uploadId: string,
  offset: number,
  baseurl: string,
  user_id: number,
  file_size: number,
): Promise<any> => {
  const formData = new FormData()
  if (uploadId) {
    formData.append('upload_id', uploadId)
  }

  formData.append('file', {
    uri: 'file://' + chunk._ref,
    type: 'application/octet-stream',
    name: 'blob',
  } as any)

  const currentChunkSize = await FileSystem.stat(chunk._ref).then(
    fileStat => fileStat.size,
  )

  formData.append('md5', '')
  formData.append('offset', offset.toString())
  formData.append('user', user_id.toString())

  // Don't set Content-Type manually — let FormData auto-generate
  // the multipart boundary. Android's fetch breaks without it.
  const result = await fetchClient.request<any>('/upload/', {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Range': `bytes ${offset}-${
        offset + currentChunkSize - 1
      }/${file_size}`,
    },
  })
  return result
}

const uploadFinished = async (
  fileName: string,
  md5: string,
  uploadId: string,
  user_id: number,
): Promise<void> => {
  const formData = new FormData()
  formData.append('upload_id', uploadId)
  formData.append('md5', md5)
  formData.append('user', user_id.toString())
  formData.append('filename', fileName)
  await fetchClient.post('/upload/complete/', formData)
}

const calculateChunks = async (file: any) => {
  const chunks = Math.ceil(file.size / chunkSize)
  const chunk: any[] = []
  for (let i = 0; i < chunks; i++) {
    const chunkEnd = Math.min((i + 1) * chunkSize, file.size)
    const blob = await new Promise(res => {
      file
        .slice(i * chunkSize, chunkEnd)
        // @ts-ignore
        .onCreated(b => {
          res(b)
        })
    })
    chunk.push(blob)
  }
  return chunk
}

export async function uploadImages(files: any[]): Promise<void> {
  const { setTotal, setCurrent, setUploading } = useUploadStore.getState()
  const { markSynced } = useLocalImagesStore.getState()

  setUploading(true)

  try {
    const fileStats = await Promise.all(
      files.map(file => FileSystem.stat(file.url)),
    )
    setTotal(fileStats.map(file => file.size).reduce((a, b) => a + b))
    let currentUploadedFileSize = 0
    const user_id = useAuthStore.getState().access?.user_id
    const baseurl = useConfigStore.getState().baseurl

    for (const file of files) {
      const fileStat = await FileSystem.stat(file.url)
      const Blob = ReactNativeBlobUtil.polyfill.Blob
      // @ts-ignore
      const selectedFile = await Blob.build(ReactNativeBlobUtil.wrap(file.url))
      const currentUploadedFileSizeStartValue = currentUploadedFileSize
      console.log('Current File: ' + fileStat.filename)

      // Check if the upload already exists
      let isAlreadyUploaded = false
      try {
        const result = await fetchClient.get<{ exists: boolean }>(
          `/exists/${file.id}/`,
        )
        isAlreadyUploaded = result.exists
      } catch {
        isAlreadyUploaded = false
      }

      let offset = 0
      let uploadId = ''
      if (!isAlreadyUploaded) {
        const chunks = await calculateChunks(selectedFile)
        for (let i = 0; i < chunks.length; i++) {
          const response = await uploadChunk(
            chunks[offset / chunkSize],
            uploadId,
            offset,
            baseurl,
            user_id ? user_id : 0,
            fileStat.size,
          )
          if (response && 'offset' in response) {
            offset = response.offset
            uploadId = response.upload_id
          }
          if (chunks[offset / chunkSize]) {
            const chunkStat = await FileSystem.stat(
              chunks[offset / chunkSize]._ref,
            )
            currentUploadedFileSize += chunkStat.size
          } else {
            const origStat = await FileSystem.stat(file.url)
            currentUploadedFileSize +=
              origStat.size -
              (currentUploadedFileSize - currentUploadedFileSizeStartValue)
          }
          setCurrent(currentUploadedFileSize)
        }
        await uploadFinished(
          fileStat.filename,
          file.id.slice(0, file.id.length - 1),
          uploadId,
          user_id ? user_id : 0,
        )
        markSynced(file)
      } else {
        console.log('File already uploaded')
        const origStat = await FileSystem.stat(file.url)
        currentUploadedFileSize += origStat.size
        setCurrent(currentUploadedFileSize)
        markSynced(file)
      }
    }
  } catch (err) {
    console.log('Error uploading images')
    console.log(JSON.stringify(err))
  } finally {
    setUploading(false)
  }
}
