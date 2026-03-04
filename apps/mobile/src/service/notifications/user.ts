import { showNotification } from '../../api_client/platform/notifications'
import i18n from '../../Translations'

function updateUser(username: string) {
  showNotification({
    message: i18n.t('toasts.updateuser', { username }),
    title: i18n.t('toasts.updateusertitle'),
    color: 'teal',
  })
}

export const user = {
  updateUser,
}
