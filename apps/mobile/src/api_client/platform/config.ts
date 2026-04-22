import { useConfigStore } from '../../stores/configStore'

export function getApiBaseUrl(): string {
  return useConfigStore.getState().baseurl + '/api'
}
