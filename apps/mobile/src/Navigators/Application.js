import React, { useEffect, useState } from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import { IndexStartupContainer, IndexLoginContainer } from '@/Containers'
import { useSelector } from 'react-redux'
import { NavigationContainer } from '@react-navigation/native'
import { navigationRef } from '@/Navigators/Root'
import { AppState, SafeAreaView, StatusBar } from 'react-native'
import { useTheme } from '@/Theme'
import { AlbumListContainer, PhotoListContainer } from '../Containers'
import {
  getManufacturerSync,
  getBrand,
  getDeviceId,
  getSystemName,
  getSystemVersion,
  getVersion,
} from 'react-native-device-info'
import { FileLogger } from 'react-native-file-logger'
import RNShake from 'react-native-shake'

const Stack = createStackNavigator()
if (__DEV__) {
const emailTemplate = ""}
else{
//react-native device info breaks debug mode!
const emailTemplate = `Manufacturer: ${getManufacturerSync()}\nBrand: ${getBrand()}\nDevice: ${getDeviceId()}\nSystem: ${getSystemName()} ${getSystemVersion()}\nApp Version:${getVersion()}`
}

let MainNavigator

// @refresh reset
const ApplicationNavigator = () => {
  const { Layout, darkMode, NavigationTheme } = useTheme()
  const { colors } = NavigationTheme
  const [isApplicationLoaded, setIsApplicationLoaded] = useState(false)
  const applicationIsLoading = useSelector(state => state.startup.loading)
  const logging = useSelector(state => state.config.logging)
  const [appState, setAppState] = useState('active')

  FileLogger.configure({
    maximumFileSize: 10 * 1024 * 1024, // 10 MiB
    maximumNumberOfFiles: 5,
  })

  useEffect(() => {
    if (MainNavigator == null && !applicationIsLoading) {
      MainNavigator = require('@/Navigators/Main').default
      setIsApplicationLoaded(true)
    }
  }, [applicationIsLoading])

  useEffect(() => {
    if (logging) {
      FileLogger.enableConsoleCapture()
    } else {
      FileLogger.disableConsoleCapture()
    }

    if (appState === 'active' && logging) {
      RNShake.addListener(() => {
        FileLogger.getLogFilePaths().then(console.log.bind(this, 'Log Files:'))
        FileLogger.sendLogFilesByEmail({
          to: 'bugreports@akshay-naik.com',
          subject: 'Bug Report',
          body: emailTemplate + '\n\nDescribe your bug: ',
        })
      })
    }

    return () => {
      FileLogger.disableConsoleCapture()
      RNShake.removeAllListeners()
    }
  }, [appState, logging])

  useEffect(() => {
    let appStateChangeEvt = AppState.addEventListener('change', state => {
      setAppState(state)
      console.log('AppState: ', state)
    })

    return () => {
      appStateChangeEvt.remove()
    }
  }, [])

  // on destroy needed to be able to reset when app close in background (Android)
  useEffect(
    () => () => {
      setIsApplicationLoaded(false)
      MainNavigator = null
    },
    [],
  )

  return (
    <SafeAreaView style={[Layout.fill, { backgroundColor: colors.card }]}>
      <NavigationContainer theme={NavigationTheme} ref={navigationRef}>
        <StatusBar barStyle={darkMode ? 'light-content' : 'dark-content'} />
        <Stack.Navigator headerMode={'none'}>
          <Stack.Screen name="Startup" component={IndexStartupContainer} />
          {isApplicationLoaded && (
            <Stack.Screen
              name="Login"
              component={IndexLoginContainer}
              options={{
                animationEnabled: false,
              }}
            />
          )}
          {isApplicationLoaded && MainNavigator != null && (
            <Stack.Screen
              name="Main"
              component={MainNavigator}
              options={{
                animationEnabled: false,
              }}
            />
          )}
          <Stack.Screen
            name="AlbumList"
            component={AlbumListContainer}
            options={{
              animationEnabled: true,
            }}
          />
          <Stack.Screen
            name="PhotoList"
            component={PhotoListContainer}
            options={{
              animationEnabled: true,
            }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  )
}

export default ApplicationNavigator
