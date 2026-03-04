import { Alert } from 'react-native'

export function showNotification({
  message,
  title,
  color,
}: {
  message: string
  title?: string
  color?: string
}) {
  if (color === 'red') {
    Alert.alert(title || 'Error', message)
  } else {
    // Success notifications: log instead of interrupting user with alerts
    console.log(`[${title || 'Notification'}] ${message}`)
  }
}
