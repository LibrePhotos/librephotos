import { useMutation } from '@tanstack/react-query'
import ReactNativeBlobUtil from 'react-native-blob-util'
import { notification } from '../../../service/notifications'
import { fetchClient } from '../../api'
import { getApiBaseUrl } from '../../platform/config'
import { tokenStorage } from '../../platform/tokenStorage'

type StatusResponse = { status: string }

type DownloadResponse = {
  url: string
  job_id: string
}

type DownloadOptions = {
  image_hashes: string[]
  include_stacked_photos?: boolean
}

async function startDownloadProcess(options: DownloadOptions) {
  const response = await fetchClient.post('/photos/download', options)
  return response as DownloadResponse
}

async function checkDownloadStatus(job_id: string) {
  const response = await fetchClient.get(`/photos/download?job_id=${job_id}`)
  return response as StatusResponse
}

async function downloadFile(filename: string) {
  const accessToken = await tokenStorage.getAccessToken()
  const baseUrl = getApiBaseUrl()
  const downloadUrl = `${baseUrl}/downloads/${filename}`

  const res = await ReactNativeBlobUtil.config({
    fileCache: true,
    addAndroidDownloads: {
      useDownloadManager: true,
      notification: true,
      title: 'photos.zip',
      mime: 'application/zip',
    },
  }).fetch('GET', downloadUrl, {
    Authorization: accessToken ? `Bearer ${accessToken}` : '',
  })

  return res.path()
}

export const useDownloadPhotosMutation = () =>
  useMutation({
    mutationFn: async ({
      image_hashes,
      userId,
      includeStackedPhotos = false,
    }: {
      image_hashes: string[]
      userId: number | null
      includeStackedPhotos?: boolean
    }) => {
      console.log('[Download] Starting download process', {
        image_hashes,
        userId,
        includeStackedPhotos,
      })
      notification.downloadStarting()

      if (!userId) {
        console.error('[Download] Failed: User ID is missing')
        notification.downloadFailed()
        throw new Error('User ID is required for download')
      }

      const { job_id: jobId, url: filename } = await startDownloadProcess({
        image_hashes,
        include_stacked_photos: includeStackedPhotos,
      })
      console.log('[Download] Job started', { jobId, filename })

      // Poll for job completion
      return new Promise((resolve, reject) => {
        const statusInterval = setInterval(async () => {
          try {
            const { status } = await checkDownloadStatus(jobId)
            console.log('[Download] Status check', { jobId, status })
            switch (status) {
              case 'SUCCESS': {
                clearInterval(statusInterval)
                const fullFilename = `${filename}${userId}`
                console.log('[Download] Job succeeded, downloading file', {
                  fullFilename,
                })
                try {
                  await downloadFile(fullFilename)
                  console.log('[Download] File downloaded, deleting zip', {
                    filename,
                  })
                  await fetchClient.delete(`/delete/zip/${filename}`)
                  notification.downloadCompleted()
                  console.log('[Download] Complete')
                  resolve({ success: true })
                } catch (err) {
                  console.error(
                    '[Download] Error during file download or cleanup',
                    err,
                  )
                  notification.downloadFailed()
                  reject(err)
                }
                break
              }

              case 'FAILURE':
                clearInterval(statusInterval)
                console.error('[Download] Job failed', { jobId })
                notification.downloadFailed()
                reject(new Error('Download job failed'))
                break

              default:
                // noop on PROGRESS
                break
            }
          } catch (err) {
            clearInterval(statusInterval)
            notification.downloadFailed()
            reject(err)
          }
        }, 3000)
      })
    },
  })
