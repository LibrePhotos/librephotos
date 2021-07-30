import api, { handleError } from '@/Services'

export default async userId => {
  if (!userId) {
    return handleError({ message: 'User ID is required' })
  }
  const response = await api.get(`users/${userId}`)
  return response.data
}
