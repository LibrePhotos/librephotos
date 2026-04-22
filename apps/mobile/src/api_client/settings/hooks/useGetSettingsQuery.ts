import { useQuery } from '@tanstack/react-query'
import { parseWithNotification } from '../../../util/zodUtils'
import { fetchClient } from '../../api'
import { SiteSettings } from '../types'

export const SiteSettingsQueryKeys = ['siteSettings'] as const

export const useGetSettingsQuery = () =>
  useQuery({
    queryKey: [...SiteSettingsQueryKeys],
    queryFn: async () => {
      const response = await fetchClient.get('/sitesettings')
      return parseWithNotification(
        SiteSettings,
        response,
        'Failed to parse site settings',
      )
    },
  })
