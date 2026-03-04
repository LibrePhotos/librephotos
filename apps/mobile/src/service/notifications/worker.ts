import { showNotification } from '../../api_client/platform/notifications'
import i18n from '../../Translations'

function jobFinished(title: string, job: string) {
  showNotification({
    message: i18n.t('toasts.jobfinished', { job }),
    title,
    color: 'teal',
  })
}

function requestFailed(title: string, message: string) {
  showNotification({
    message,
    title,
    color: 'red',
  })
}

export const worker = {
  jobFinished,
  requestFailed,
}
