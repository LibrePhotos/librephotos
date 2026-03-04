import 'react-native-gesture-handler'
import React from 'react'
import { NativeBaseProvider } from 'native-base'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/api_client/api'
import { ApplicationNavigator } from '@/Navigators'
import './Translations'
if (__DEV__) {
  import('./ReactotronConfig').then(() => console.log('Reactotron Configured'))
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <NativeBaseProvider>
      <ApplicationNavigator />
    </NativeBaseProvider>
  </QueryClientProvider>
)

export default App
